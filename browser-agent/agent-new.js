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
const MAX_STEPS = 12;

let screenshotCount = 0;
const MAX_SCREENSHOTS = 3;

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

const sendKeys = tool({
  name: 'send_keys',
  description: 'Types text. If selector is provided, focuses it first.',
  parameters: z.object({
    text: z.string(),
    selector: z.string().nullable(),
  }),
  async execute({ text, selector }) {
    const gate = stepGate('send_keys'); if (gate) return gate;
    if (selector) {
      await page.waitForSelector(selector, { state: 'attached', timeout: 8000 });
      await page.focus(selector);
    }
    await page.keyboard.type(text);
    lastAction = 'type';
    const msg = `[send_keys] typed ${JSON.stringify(text)}${selector ? ` into ${selector}` : ''}`;
    console.log(msg);
    return msg;
  },
});

// ---------- Specialist Agents ----------
const VisionAgent = new Agent({
  name: 'VisionAgent',
  model: 'gpt-4o-mini',
  instructions: `
You analyze screenshots and advise the next UI action.
- Call 'take_screenshot' ONCE when asked.
- Describe key fields/buttons/errors succinctly.
- Suggest concrete next steps with likely selectors.
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
- If a selector is provided, focus it first; otherwise type into the active element.
- Return a short confirmation.
  `,
  tools: [sendKeys],
});

// ---------- Handoff tools (run sub-agents) ----------
const handoffToVision = tool({
  name: 'handoff_to_vision',
  description: 'Ask VisionAgent to screenshot and analyze the current page.',
  parameters: z.object({ request: z.string().min(1) }),
  async execute({ request }) {
    const gate = stepGate('handoff_to_vision'); if (gate) return gate;
    console.log(`[handoff_to_vision] -> "${request}"`);
    const res = await run(VisionAgent, request, { max_output_tokens: 200 });
    console.log('[handoff_to_vision] <- VisionAgent said:');
    console.log(res);   // 👈 logs full text output
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
    const res = await run(MouseAgent, instruction, { max_output_tokens: 128 });
    console.log('[handoff_to_mouse] <- done');
    return String(res ?? '');
  },
});

const handoffToKeyboard = tool({
  name: 'handoff_to_keyboard',
  description: 'Ask KeyboardAgent to type text (optionally by selector).',
  parameters: z.object({
    text: z.string().min(1),
    selector: z.string().nullable(),
  }),
  async execute({ text, selector }) {
    const gate = stepGate('handoff_to_keyboard'); if (gate) return gate;
    console.log(`[handoff_to_keyboard] -> selector=${selector ?? 'null'} text=${JSON.stringify(text)}`);
    const res = await run(
      KeyboardAgent,
      selector
        ? `Type the following into ${selector}: ${text}`
        : `Type the following into the active element: ${text}`,
      { max_output_tokens: 128 }
    );
    console.log('[handoff_to_keyboard] <- done');
    return String(res ?? '');
  },
});

// ---------- Orchestrator Agent ----------
const Orchestrator = new Agent({
  name: 'Orchestrator',
  model: 'gpt-4o-mini',
  instructions: `
You are a cost-aware coordinator.

Policy:
- If the prompt includes a URL, FIRST call 'open_url' once.
- After any state change (open_url, click, send_keys), call 'handoff_to_vision' at most once.
- Never take two screenshots in a row.
- Prefer selectors; coordinates are last resort.
- Keep steps minimal; stop when done or when step budget is reached (${MAX_STEPS}).
  `,
  tools: [openURL, handoffToVision, handoffToMouse, handoffToKeyboard],
});

// ---------- Example run ----------
await run(
  Orchestrator,
  `Go to https://ui.chaicode.com/auth/signup and register:
   - Name: Parth Tuteja  (enter seperately in firstname and lastname)
   - Email: parth2teja@gmail.com  (try input[type="email"])
   - Password: abc@1234  (try input[type="password"])
   - Submit the form (try button[type="submit"])`,
  { max_output_tokens: 256 }
);

// keep browser open for inspection; close when you want:
// await browser.close();
