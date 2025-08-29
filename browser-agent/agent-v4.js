// agent_generic_v4.js
import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { RECOMMENDED_PROMPT_PREFIX } from '@openai/agents-core/extensions';
import { z } from 'zod';
import { chromium } from 'playwright';

// -------------------- Playwright bootstrap --------------------
const browser = await chromium.launch({
  headless: false,
  args: ['--disable-extensions', '--disable-file-system'],
});
const page = await browser.newPage();

// -------------------- Cost / loop guards --------------------
let steps = 0;
const MAX_STEPS = 12;

let screenshotCount = 0;
const MAX_SCREENSHOTS = 4;

let lastAction = 'none'; // 'nav' | 'click' | 'type' | 'scroll' | 'wait' | 'screenshot'

// simple limiter
function stepGate(tag) {
  steps += 1;
  if (steps > MAX_STEPS) {
    const msg = `HALT: step budget exceeded (${MAX_STEPS}). Last step: ${tag}`;
    console.log(msg);
    return msg;
  }
  return null;
}

// -------------------- Generic, site-agnostic tools --------------------

// 1) Navigation
const open_url = tool({
  name: 'open_url',
  description: 'Navigate to an absolute URL (e.g., https://example.com). Use this to start or move to a new page.',
  parameters: z.object({ url: z.string().min(1) }),
  async execute({ url }) {
    const stop = stepGate('open_url'); if (stop) return stop;
    let final = url.trim();
    try { final = new URL(final).toString(); } catch { throw new Error(`Invalid URL: "${url}"`); }
    await page.goto(final, { waitUntil: 'domcontentloaded' });
    lastAction = 'nav';
    console.log(`[open_url] navigated: ${final}`);
    return `Opened ${final}`;
  },
});

// 2) Vision (compact)
const take_screenshot = tool({
  name: 'take_screenshot',
  description: 'Capture a compact JPEG (800x600, low quality). Use sparingly for situational awareness.',
  parameters: z.object({
    clip: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
    quality: z.number().min(10).max(70).nullable(),
  }),
  async execute({ clip, quality }) {
    if (lastAction === 'screenshot') return 'Skipped: screenshot just taken.';
    if (screenshotCount >= MAX_SCREENSHOTS) return 'Skipped: screenshot budget exhausted.';
    const stop = stepGate('take_screenshot'); if (stop) return stop;

    const base64 = await page.screenshot({
      type: 'jpeg',
      encoding: 'base64',
      quality: quality ?? 30,
      ...(clip ? { clip } : { clip: { x: 0, y: 0, width: 800, height: 600 } }),
    });
    screenshotCount += 1;
    lastAction = 'screenshot';
    console.log(`[take_screenshot] #${screenshotCount}`);
    return base64; // LLM can “see” it
  },
});

// 3) Survey DOM (generic semantic map, no site-specific fields)
const survey_dom = tool({
  name: 'survey_dom',
  description:
    'Return a concise JSON list of visible interactive elements and headings: ' +
    'each item has {role, text, placeholder, ariaLabel, name, id, type, href, selector}. ' +
    'Use it to pick selectors for clicking/typing. Returns at most 30 items.',
  parameters: z.object({}), // no input
  async execute() {
    const items = await page.evaluate(() => {
      const cssEscape = (s) => (s || '').replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
      const selFor = (el) => {
        if (!el) return null;
        if (el.id) return `#${cssEscape(el.id)}`;
        if (el.getAttribute('data-testid')) return `[data-testid="${cssEscape(el.getAttribute('data-testid'))}"]`;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${cssEscape(el.name)}"]`;
        // fallback by tag+type
        if (el.tagName === 'INPUT' && el.type) return `input[type="${cssEscape(el.type)}"]`;
        if (el.tagName === 'BUTTON') return 'button';
        if (el.tagName === 'A') return 'a';
        return el.tagName.toLowerCase();
      };
      const visible = (el) => {
        const cs = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs && cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 2 && r.height > 2;
      };

      const roles = ['button', 'a', 'input', 'textarea', 'select', 'h1', 'h2', 'h3'];
      const found = [];
      for (const tag of roles) {
        for (const el of document.querySelectorAll(tag)) {
          if (!visible(el)) continue;
          const role =
            tag === 'a' ? 'link' :
            tag === 'input' ? (el.type === 'password' ? 'password' : (el.type === 'email' ? 'email' : 'input')) :
            tag === 'textarea' ? 'textarea' :
            tag === 'select' ? 'select' :
            tag.startsWith('h') ? 'heading' : 'button';

          const text = (el.innerText || el.value || '').trim();
          const placeholder = el.getAttribute?.('placeholder') || null;
          const ariaLabel = el.getAttribute?.('aria-label') || null;
          const name = el.getAttribute?.('name') || null;
          const id = el.id || null;
          const type = el.getAttribute?.('type') || null;
          const href = el.getAttribute?.('href') || null;
          const selector = selFor(el);
          found.push({ role, text, placeholder, ariaLabel, name, id, type, href, selector });
        }
      }

      // Also add obvious “submit / continue” inputs
      for (const el of document.querySelectorAll('input[type="submit"]')) {
        if (!visible(el)) continue;
        const text = el.value?.trim() || 'Submit';
        const selector = selFor(el);
        found.push({ role: 'button', text, placeholder: null, ariaLabel: null, name: el.name || null, id: el.id || null, type: 'submit', href: null, selector });
      }

      // Dedup by selector+text, cap 30
      const key = (x) => `${x.selector}::${x.text}`;
      const map = new Map();
      for (const x of found) if (x.selector) map.set(key(x), x);
      return Array.from(map.values()).slice(0, 30);
    });

    const json = JSON.stringify(items);
    console.log('[survey_dom] ->', json.slice(0, 400) + (json.length > 400 ? '…' : ''));
    return json;
  },
});

// 4) Actions
const click_selector = tool({
  name: 'click_selector',
  description: 'Click an element by CSS selector.',
  parameters: z.object({ selector: z.string().min(1) }),
  async execute({ selector }) {
    const stop = stepGate('click_selector'); if (stop) return stop;
    await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
    await page.click(selector);
    lastAction = 'click';
    console.log(`[click_selector] ${selector}`);
    return `Clicked ${selector}`;
  },
});

const fill_selector = tool({
  name: 'fill_selector',
  description: 'Clear and type text into a field using page.fill().',
  parameters: z.object({ selector: z.string().min(1), text: z.string() }),
  async execute({ selector, text }) {
    const stop = stepGate('fill_selector'); if (stop) return stop;
    await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
    await page.fill(selector, text);
    lastAction = 'type';
    const msg = `[fill_selector] ${selector} = ${JSON.stringify(text)}`;
    console.log(msg);
    return msg;
  },
});

const press_key = tool({
  name: 'press_key',
  description: 'Press a single key on the keyboard (e.g., Enter).',
  parameters: z.object({ key: z.string().min(1) }),
  async execute({ key }) {
    const stop = stepGate('press_key'); if (stop) return stop;
    await page.keyboard.press(key);
    lastAction = 'type';
    console.log(`[press_key] ${key}`);
    return `Pressed ${key}`;
  },
});

const scroll = tool({
  name: 'scroll',
  description: 'Scroll the page by pixels. Positive y scrolls down.',
  parameters: z.object({ x: z.number().nullable(), y: z.number().nullable() }),
  async execute({ x, y }) {
    const stop = stepGate('scroll'); if (stop) return stop;
    await page.mouse.wheel(x ?? 0, y ?? 600);
    lastAction = 'scroll';
    console.log(`[scroll] x=${x ?? 0} y=${y ?? 600}`);
    return `Scrolled`;
  },
});

const wait_for_selector = tool({
  name: 'wait_for_selector',
  description: 'Wait for a selector to appear or become visible.',
  parameters: z.object({ selector: z.string().min(1) }),
  async execute({ selector }) {
    const stop = stepGate('wait_for_selector'); if (stop) return stop;
    await page.waitForSelector(selector, { state: 'visible', timeout: 15000 });
    lastAction = 'wait';
    console.log(`[wait_for_selector] ${selector}`);
    return `Visible: ${selector}`;
  },
});

// 5) Read page text (quick extract)
const read_text = tool({
  name: 'read_text',
  description: 'Return a concise slice of visible page text (first ~2000 chars). Useful to answer questions after navigation.',
  parameters: z.object({}), // none
  async execute() {
    const text = await page.evaluate(() => {
      const getText = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
      return getText(document.body).slice(0, 2000);
    });
    console.log('[read_text] len=', text.length);
    return text;
  },
});

// -------------------- The general-purpose agent --------------------
const BrowserAgent = new Agent({
  name: 'Generic Browser Agent',
  model: 'gpt-4o-mini',
  instructions: `${RECOMMENDED_PROMPT_PREFIX}
You are a general-purpose web agent that can browse, search, read, and interact with sites.
Follow this loop until the task is complete or the step budget is reached (${MAX_STEPS}):

Policy:
- If a URL is in the task, call open_url once.
- Use survey_dom to discover visible elements and selectors before clicking or typing.
- Prefer click_selector and fill_selector with selectors from survey_dom.
- Use take_screenshot sparingly (<= ${MAX_SCREENSHOTS}); never twice in a row.
- Use read_text to extract content for answering questions.
- Use wait_for_selector after any action that should cause a navigation or UI change.
- Keep outputs short and actionable. Do not narrate your chain-of-thought; just act.

Examples of things you can do:
- Navigate to a site, find and click “Pricing”, read prices, and report.
- Search on a site: focus the search box, type the query, press Enter, click a result, summarize.
- Fill login or signup fields when asked (based on survey_dom results).

Return a concise final answer to the user’s task when done.
`,
  tools: [
    open_url,
    survey_dom,
    click_selector,
    fill_selector,
    press_key,
    scroll,
    wait_for_selector,
    read_text,
    take_screenshot,
  ],
});

// -------------------- Run: give it any goal --------------------
// const TASK = `Go to https://ui.chaicode.com and find the sign up code under authentication. Fill the following details: Name - Parth Tuteja. Email - parth@example.com. Password - securePassword123.`;
const TASK = `Go to https://www.youtube.com and seach for never gonna give you up and play the video that comes up at top `;

const result = await run(BrowserAgent, TASK, {
  max_output_tokens: 300,
  temperature: 0, // deterministic
});

console.log('\n====== RESULT ======');
console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
console.log('====================\n');

// Keep browser open for inspection; close when you want:
// await browser.close();
