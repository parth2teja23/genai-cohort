import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-extensions', '--disable-file-system'],
});

const page = await browser.newPage();

const takeScreenshot = tool({
  name: 'take_screenshot',
  description: 'Capture a compact JPEG screenshot. Use clip to select a small region.',
  parameters: z.object({
    // required but nullable to satisfy structured outputs rules
    clip: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }).nullable(),
    quality: z.number().min(10).max(80).nullable(), // default 40
  }),
  async execute({ clip, quality }) {
    const opts = {
      type: 'jpeg',
      quality: quality ?? 40,             // lower quality → fewer tokens
      encoding: 'base64',
      ...(clip ? { clip } : { clip: { x: 0, y: 0, width: 900, height: 700 } }), // default thumbnail
    };
    const base64 = await page.screenshot(opts);
    console.log(`Screenshot taken`);

    return base64;
  },
});


const openBrowser = tool({
  name: 'open_browser',
  description: 'No-op (browser already launched).',
  parameters: z.object({}),                 // ✅
  async execute() {
        console.log(`Browser opened`);

    return 'Browser ready';
  },
});

const openURL = tool({
  name: 'open_url',
  description: 'Navigate to a URL.',
  // ❌ z.string().url() -> causes format: "uri" (rejected)
  // ✅ use plain string, required
  parameters: z.object({
    url: z.string().min(1).describe('Absolute URL to open (e.g., https://example.com)'),
  }),
  async execute({ url }) {
    // runtime validation (safe for the API)
    let finalUrl = url.trim();
    try {
      // Throws if invalid; also normalizes
      const u = new URL(finalUrl);
      finalUrl = u.toString();
    } catch {
      throw new Error(`Invalid URL: "${url}"`);
    }

    await page.goto(finalUrl, { waitUntil: 'domcontentloaded' });
        console.log(`Navigated to ${finalUrl}`);

    return `Opened ${finalUrl}`;

  },
});

const clickOnScreen = tool({
  name: 'click_screen',
  description: 'Click at screen coordinates.',
  parameters: z.object({
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
  }),
  async execute({ x, y }) {
    await page.mouse.click(x, y);
        console.log(`Clicked at (${x}, ${y})`);

    return `Clicked at (${x}, ${y})`;

  },
});

const sendKeys = tool({
  name: 'send_keys',
  description: 'Type text into the active element or a selector.',
  parameters: z.object({
    text: z.string().describe('Text to type'),
    // Make it required but nullable (instead of optional)
    selector: z.string().nullable().describe(
      'CSS selector to focus before typing; use null to type into the active element'
    ),
  }),
  async execute({ text, selector }) {
    if (selector) {
      await page.waitForSelector(selector, { state: 'attached', timeout: 5000 });
      await page.focus(selector);
    }
    await page.keyboard.type(text);
    console.log(`Typed ${JSON.stringify(text)}${selector ? ` into ${selector}` : ''}`);
  },
});


const websiteAutomationAgent = new Agent({
  name: 'WebSite Automation Agent',
  model: 'gpt-4.1-mini',
  instructions: `
You are a browser automation agent.

Rules:
- Always call 'take_screenshot' after each step to see what is happening.
- After taking a screenshot, plan the next action.
`,
  tools: [takeScreenshot, openBrowser, openURL, clickOnScreen, sendKeys],
});

// Example run:
await run(websiteAutomationAgent, 
  `Go to https://ui.chaicode.com/auth/signup and enter the contact form with:
- Name: Parth Tuteja
- Email: parth2teja@gmail.com
- Password: abc@1234
`,
);
