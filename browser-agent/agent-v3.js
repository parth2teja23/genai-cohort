// agent.js
import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { chromium } from 'playwright';

// ---------- Playwright bootstrap (shared page) ----------
const browser = await chromium.launch({
  headless: false,
  args: ['--disable-extensions', '--disable-file-system'],
});
const page = await browser.newPage();

// ---------- Global cost guards ----------
let steps = 0;
const MAX_STEPS = 20;

let screenshotCount = 0;
const MAX_SCREENSHOTS = 8;

let lastAction = 'none'; // 'nav' | 'click' | 'type' | 'screenshot'

function stepGate(tag) {
  steps += 1;
  if (steps > MAX_STEPS) {
    const msg = `HALT: step budget exceeded (${MAX_STEPS}). Last step: ${tag}`;
    console.log(msg);
    return msg;
  }
  return null;
}

// ---------- Low-level tools ----------
const takeScreenshot = tool({
  name: 'take_screenshot',
  description: 'Compact JPEG screenshot. Use only after a state change.',
  parameters: z.object({
    clip: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }).nullable(),
    quality: z.number().min(10).max(70).nullable(), // default 30
  }),
  async execute({ clip, quality }) {
    if (lastAction === 'screenshot') return 'Skipped: screenshot just taken.';
    if (screenshotCount >= MAX_SCREENSHOTS) return 'Skipped: screenshot budget exhausted.';
    const gate = stepGate('screenshot'); if (gate) return gate;

    const base64 = await page.screenshot({
      type: 'jpeg',
      quality: quality ?? 30,
      encoding: 'base64',
      ...(clip ? { clip } : { clip: { x: 0, y: 0, width: 800, height: 600 } }),
    });
    screenshotCount += 1;
    lastAction = 'screenshot';
    console.log(`[take_screenshot] #${screenshotCount}`);
    return base64;
  },
});

const openURL = tool({
  name: 'open_url',
  description: 'Navigate to an absolute URL (e.g., https://example.com).',
  parameters: z.object({ url: z.string().min(1) }),
  async execute({ url }) {
    const gate = stepGate('open_url'); if (gate) return gate;
    let finalUrl = url.trim();
    try { finalUrl = new URL(finalUrl).toString(); }
    catch { throw new Error(`Invalid URL: "${url}"`); }
    await page.goto(finalUrl, { waitUntil: 'domcontentloaded' });
    lastAction = 'nav';
    console.log(`[open_url] navigated: ${finalUrl}`);
    return `Opened ${finalUrl}`;
  },
});

const clickSelector = tool({
  name: 'click_selector',
  description: 'Clicks a DOM element by CSS selector.',
  parameters: z.object({ selector: z.string().min(1) }),
  async execute({ selector }) {
    const gate = stepGate('click_selector'); if (gate) return gate;
    await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
    await page.click(selector);
    lastAction = 'click';
    console.log(`[click_selector] clicked: ${selector}`);
    return `Clicked ${selector}`;
  },
});

const clickScreen = tool({
  name: 'click_screen',
  description: 'Clicks at absolute screen coordinates.',
  parameters: z.object({ x: z.number(), y: z.number() }),
  async execute({ x, y }) {
    const gate = stepGate('click_screen'); if (gate) return gate;
    await page.mouse.click(x, y);
    lastAction = 'click';
    console.log(`[click_screen] clicked at (${x}, ${y})`);
    return `Clicked at (${x}, ${y})`;
  },
});

const fillSelector = tool({
  name: 'fill_selector',
  description: 'Clears and types text into a field using page.fill().',
  parameters: z.object({
    selector: z.string().min(1),
    text: z.string(),
  }),
  async execute({ selector, text }) {
    const gate = stepGate('fill_selector'); if (gate) return gate;
    await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
    await page.fill(selector, text);
    lastAction = 'type';
    const msg = `[fill_selector] filled ${selector} with ${JSON.stringify(text)}`;
    console.log(msg);
    return msg;
  },
});

// NEW: DOM probe — reliably find common signup fields without LLM
const detectFormFields = tool({
  name: 'detect_form_fields',
  description: 'Detect common signup fields (firstName, lastName, fullName, email, password, submit) and return CSS selectors as JSON.',
  parameters: z.object({}), // required empty object
  async execute() {
    const data = await page.evaluate(() => {
      // tiny helper to build a stable selector for an element
      const cssEscape = (s) => s.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
      const selFor = (el) => {
        if (el.id) return `#${cssEscape(el.id)}`;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${cssEscape(el.name)}"]`;
        if (el.getAttribute('data-testid')) return `[data-testid="${cssEscape(el.getAttribute('data-testid'))}"]`;
        // fallback by type (risky, but okay if specific)
        if (el.tagName === 'INPUT' && el.type) return `input[type="${cssEscape(el.type)}"]`;
        return null;
      };

      const textOf = (el) => (el?.innerText || el?.value || '').toLowerCase().trim();
      const attrStr = (el) =>
        [
          el.getAttribute('name'),
          el.getAttribute('id'),
          el.getAttribute('placeholder'),
          el.getAttribute('aria-label'),
          el.getAttribute('autocomplete'),
          el.getAttribute('data-testid'),
          textOf(el),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

      const inputs = Array.from(document.querySelectorAll('input,button'));
      const result = { firstName: null, lastName: null, fullName: null, email: null, password: null, submit: null };

      // map label->control too
      for (const label of document.querySelectorAll('label')) {
        const lab = label.innerText?.toLowerCase() || '';
        const forId = label.getAttribute('for');
        const el = forId ? document.getElementById(forId) : null;
        const s = el ? selFor(el) : null;
        if (s) {
          if (/first.*name/.test(lab)) result.firstName = result.firstName || s;
          if (/last.*name|surname|family.*name/.test(lab)) result.lastName = result.lastName || s;
          if (/full.*name|name/.test(lab)) result.fullName = result.fullName || s;
          if (/email/.test(lab)) result.email = result.email || s;
          if (/password|pass/.test(lab)) result.password = result.password || s;
        }
      }

      for (const el of inputs) {
        const a = attrStr(el);
        const s = selFor(el);
        if (el.tagName === 'INPUT') {
          if (!result.firstName && /first.*name/.test(a)) result.firstName = s;
          if (!result.lastName && /(last.*name|surname|family.*name)/.test(a)) result.lastName = s;
          if (!result.fullName && /full.*name/.test(a)) result.fullName = s;
          if (!result.email && (el.type === 'email' || /email/.test(a))) result.email = s;
          if (!result.password && (el.type === 'password' || /(password|pass)/.test(a))) result.password = s;
        }
        if (!result.submit) {
          const isButton =
            el.tagName === 'BUTTON' ||
            (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button'));
          if (isButton && /(sign.?up|register|create.?account|submit|continue)/.test(a)) {
            result.submit = s || 'button[type="submit"], input[type="submit"]';
          }
        }
      }
      return result;
    });

    const json = JSON.stringify(data);
    console.log('[detect_form_fields] ->', json);
    return json;
  },
});

// keep your original agents
const VisionAgent = new Agent({
  name: 'VisionAgent',
  model: 'gpt-4o-mini',
  instructions: `
You analyze screenshots and advise the next UI action.
- Call 'take_screenshot' ONCE when asked.
- Describe key fields/buttons/errors succinctly.
- Suggest concrete next steps with likely selectors if visible.
  `,
  tools: [takeScreenshot],
});

const MouseAgent = new Agent({
  name: 'MouseAgent',
  model: 'gpt-4o-mini',
  instructions: `
You execute mouse actions.
- Prefer 'click_selector' when a selector is provided; otherwise use 'click_screen'.
- Return a short confirmation.
  `,
  tools: [clickSelector, clickScreen],
});

const KeyboardAgent = new Agent({
  name: 'KeyboardAgent',
  model: 'gpt-4o-mini',
  instructions: `
You type into fields.
- Use 'fill_selector' to clear and type.
- If a selector is provided, focus/fill it; otherwise this agent will not act.
- Return a short confirmation.
  `,
  tools: [fillSelector],
});

// ---------- Handoff tools (run sub-agents) ----------
const handoffToVision = tool({
  name: 'handoff_to_vision',
  description: 'Ask VisionAgent to screenshot and analyze the current page.',
  parameters: z.object({ request: z.string().min(1) }),
  async execute({ request }) {
    const gate = stepGate('handoff_to_vision'); if (gate) return gate;
    console.log(`[handoff_to_vision] -> "${request}"`);
    const res = await run(VisionAgent, request, { max_output_tokens: 220, temperature: 0.2 });
    console.log('[handoff_to_vision] <- VisionAgent said:');
    console.log(typeof res === 'string' ? res : JSON.stringify(res));
    return String(res ?? '');
  },
});

const handoffToMouse = tool({
  name: 'handoff_to_mouse',
  description: 'Ask MouseAgent to click by selector or coordinates.',
  parameters: z.object({
    selector: z.string().nullable(),
    x: z.number().nullable(),
    y: z.number().nullable(),
  }),
  async execute({ selector, x, y }) {
    const gate = stepGate('handoff_to_mouse'); if (gate) return gate;
    console.log(`[handoff_to_mouse] -> selector=${selector ?? 'null'} coords=${x ?? 'null'},${y ?? 'null'}`);
    let instruction = '';
    if (selector) instruction = `Click this selector exactly: ${selector}`;
    else if (typeof x === 'number' && typeof y === 'number') instruction = `Click at coordinates (${x}, ${y}).`;
    else throw new Error('Provide either selector or coordinates.');
    const res = await run(MouseAgent, instruction, { max_output_tokens: 128, temperature: 0 });
    console.log('[handoff_to_mouse] <- done');
    return String(res ?? '');
  },
});

const handoffToKeyboard = tool({
  name: 'handoff_to_keyboard',
  description: 'Ask KeyboardAgent to fill text into a selector.',
  parameters: z.object({
    selector: z.string().min(1),
    text: z.string().min(1),
  }),
  async execute({ selector, text }) {
    const gate = stepGate('handoff_to_keyboard'); if (gate) return gate;
    console.log(`[handoff_to_keyboard] -> fill ${selector} = ${JSON.stringify(text)}`);
    const res = await run(KeyboardAgent, `Fill ${selector} with: ${text}`, { max_output_tokens: 128, temperature: 0 });
    console.log('[handoff_to_keyboard] <- done');
    return String(res ?? '');
  },
});

// ---------- NEW: add detect_form_fields to Orchestrator toolset ----------
const Orchestrator = new Agent({
  name: 'Orchestrator',
  model: 'gpt-4o-mini',
  instructions: `
You are a strict coordinator.

Workflow:
1) If the task includes a URL, call 'open_url' first.
2) Call 'handoff_to_vision' to get a fresh description of the UI.
3) Call 'detect_form_fields' to retrieve JSON with selectors for firstName, lastName, fullName, email, password, submit.
4) Using those selectors:
   - If 'fullName' exists, fill it with the full name.
   - Else fill 'firstName' and 'lastName' separately.
   - Fill 'email' and 'password' if present.
   - Then click 'submit' if present.
5) After each action group, call 'handoff_to_vision' once to verify state.
6) Stop when the form appears submitted or a confirmation appears.

Rules:
- Prefer 'fill_selector' over typing.
- Only use selectors returned by detect_form_fields (do not guess).
- Keep steps minimal and deterministic.
  `,
  tools: [
    openURL,
    handoffToVision,
    detectFormFields,
    handoffToKeyboard,
    handoffToMouse,
  ],
});

// ---------- Example run ----------
await run(
  Orchestrator,
  `Go to https://ui.chaicode.com/auth/signup and register:
   - Full Name: Parth Tuteja
   - First Name: Parth
   - Last Name: Tuteja
   - Email: parth2teja@gmail.com
   - Password: abc@1234
   Then submit the form.`,
  { max_output_tokens: 300, temperature: 0 }
);

// keep browser open for inspection; close when you want:
// await browser.close();
