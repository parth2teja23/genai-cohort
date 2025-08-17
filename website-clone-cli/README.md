# clone-site.mjs — HTML + CSS + Assets Cloner

A simple Node.js CLI that clones a web page’s **server-rendered HTML**, consolidates **all CSS** (including `@import`s), downloads referenced **assets** (images, fonts, icons, JS, etc.), and rewrites paths so the site works **offline**.

### made by parth2teja
### github: parth2teja23
### portfolio: parth2teja.in


It preserves your “agent” vibe by logging JSON steps to **stderr** in the sequence:

```
START → THINK → TOOL → OBSERVE → OUTPUT
```

Meanwhile, the actual files are written to disk.

---

## Features

- **HTML**: Fetches server HTML (pre-JS DOM).
- **CSS**: Gathers linked stylesheets, inlines `@import` (depth 2), rewrites `url(...)` to local files, emits a single `style.css`.
- **Assets**: Downloads assets from:
  - HTML: `<img>`, `<source>`, `<video>`, `<audio>`, `<script>`, icons, `manifest`, `srcset`, inline `style="background:url(...)"`.
  - CSS: `url(...)` references (images, fonts, etc.) + `@import`.
  - `data-src`, `data-srcset`, `data-original`, `data-lazy`, and `<noscript>` fallbacks.
- **Hotlink-friendly**: Sends `Referer` and `Origin` headers (plus a browserlike `User-Agent`) to reduce 403s from CDNs.
- **Idempotent output**: Creates a new folder (e.g., `google`, or `google-1`, `google-2`, …) to avoid clobbering.
- **Concurrency**: Parallel downloads for speed.
- **Agent logs**: Human-readable progress to stderr; keeps stdout/file system clean.

---

## Requirements

- **Node.js 18+** (ESM-friendly, stable fetch/crypto APIs)
- **npm** (or pnpm/yarn)

---

## Install
1) Create a .env file and add openai key as OPENAI_API_KEY=YOUR_OPENAI_KEY
2) Save the script as `clone-site.mjs`.
3) Install deps:
```bash
npm init -y
npm i axios cheerio mime-types
```

---

## Usage

```bash
node clone-site.mjs <url> [--outdir folder] [--ua "User-Agent"] [--timeout ms] [--concurrency N] [--verbose]
```

**Examples**
```bash
# Basic clone (creates ./google with index.html, style.css, assets/*)
node clone-site.mjs www.google.com

# Custom output folder name
node clone-site.mjs https://example.com --outdir example

# Tweak timeouts and concurrency, print verbose asset logs
node clone-site.mjs https://news.ycombinator.com --timeout 30000 --concurrency 12 --verbose

# Spoof a UA if a site is picky
node clone-site.mjs https://site.tld --ua "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36"
```

**Flags**
- `--outdir` — Output directory (default derived from the hostname).  
- `--ua` — Custom User-Agent header.  
- `--timeout` — Request timeout in ms (default 20000).  
- `--concurrency` — Parallel asset downloads (default 8).  
- `--verbose` / `-v` — Print per-asset success/failure lines to stderr.

---

## Output Structure

```
<outdir>/
├─ index.html      # HTML rewritten to use local assets & style.css
├─ style.css       # Consolidated CSS with urls rewritten locally
└─ assets/
   ├─ img/         # images, icons, SVGs, etc.
   ├─ fonts/       # woff/woff2/ttf/otf/eot
   ├─ js/          # external <script src="..."> files
   └─ other/       # anything that didn't fit above
```

All asset filenames are made collision-resistant (short SHA-1 suffix), and extensions are inferred from the `Content-Type` when missing.

---

## Serving Locally

Some browsers restrict access with the `file://` scheme. It’s best to serve the folder:

```bash
npx http-server <outdir> -p 8080
# or
npx serve <outdir>
```

Then open `http://localhost:8080/`.

---

## How It Works (High Level)

1. **Fetch HTML** (with browserlike headers, `Referer`/`Origin` set to the page URL).  
2. **Extract styles**:
   - Collect `<link rel="stylesheet">` and `<style>` blocks.
   - Inline `@import` (depth 2).
   - Normalize all `url(...)` to absolute URLs; collect asset URLs referenced by CSS.
3. **Collect HTML assets**:
   - Standard tags: `img/src`, `script/src`, icons, `srcset`, `link rel="manifest"`, media sources.
   - Lazy patterns: `data-src`, `data-srcset`, `data-original`, `data-lazy`.
   - `<noscript>` fallbacks (parse their inner HTML).
   - Inline `style="...url(...)"`.
4. **Download assets** in parallel with proper headers (incl. `Referer`), classify by MIME/extension, and save under `assets/*`.
5. **Rewrite**:
   - Replace absolute asset URLs in **CSS** with local relative paths.
   - Replace absolute asset URLs in **HTML** attributes (`src`, `href`, `srcset`, inline styles) with local paths.
   - Replace all existing stylesheet references with a single `<link rel="stylesheet" href="style.css">`.
6. **Emit files**: `index.html`, `style.css`, and `assets/*`.
7. **Log steps** to stderr as JSON objects with `step: START|THINK|TOOL|OBSERVE|OUTPUT`.

---

## Limitations & Notes

- **Server HTML only**: This captures the HTML as returned by the server. If a page builds content via client-side JS (React/Vue/Next/SPA), that DOM won’t be present.  
  - **Upgrade path**: Add a **headless render** (Playwright) step to load the page, wait for network idle, snapshot the DOM, then run the same pipeline.
- **CDN / Anti-bot**: Some CDNs enforce hotlink protection, signed URLs, cookies, or dynamic tokens. The tool sends `Referer`, `Origin`, and a browserlike UA to help—but some assets may still 403/401/expire.
- **Dynamic endpoints**: JSON APIs, streaming media, and authenticated resources are not handled.
- **Legal/Ethical**: Respect each site’s **Terms of Service** and **robots.txt**. Use responsibly and only on content you’re allowed to copy.

---

## Troubleshooting

- **“Images don’t load” locally**  
  - Serve via HTTP (see “Serving Locally”).
  - Run with `--verbose` and check stderr for `[asset FAIL] ... :: 403/404`.
  - Try a different UA string with `--ua`.  
- **Some images/fonts still missing**  
  - They may be added after hydration or require cookies/tokens. Consider a headless render approach.
- **SyntaxError: cheerio default export**  
  - Use `import { load } from 'cheerio'` (ESM named import). Ensure you installed `cheerio` and are running Node 18+.
- **EAI_AGAIN / ETIMEDOUT**  
  - Increase `--timeout`, reduce `--concurrency`, or retry on a more stable network.

---

## Example Session

```bash
node clone-site.mjs https://news.ycombinator.com --verbose
# STDERR (snippets):
{"step":"START","content":"Clone HTML+CSS+assets for https://news.ycombinator.com"}
{"step":"TOOL","tool_name":"fetchHTML","input":"{\"url\":\"https://news.ycombinator.com\"}"}
{"step":"OBSERVE","content":"Fetched HTML https://news.ycombinator.com (len=...)"}
[asset OK] https://.../logo2x.png (1234B)
[asset OK] https://.../news.css (53210B)
...
{"step":"OUTPUT","content":"Saved site to news/ (index.html, style.css, assets/*)"}

# Files:
# ./news/index.html
# ./news/style.css
# ./news/assets/img/* ...
```

---

## Extending

- **Headless mode** (Playwright): Render JS-heavy sites and then clone the rendered DOM.  
- **Deeper asset support**: Download fonts referenced by @font-face from `<style>` attributes.  
- **Deduplicate assets**: Hash file contents to avoid duplicates across different URLs.  
- **Sitemaps / multi-page**: Crawl internal links up to N pages and mirror a small site.

---

## License

MIT

---

## Credits
Built by Parth Tuteja
Youtube link: https://youtu.be/MpiAInHGOKU
Built with **Node.js**, **axios**, **cheerio**, and **mime-types**. Logs inspired by  **START → THINK → TOOL → OBSERVE → OUTPUT** step format taught in GenAI Cohort.
