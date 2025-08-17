#!/usr/bin/env node
import axios from 'axios';
import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import crypto from 'node:crypto';
import mime from 'mime-types';

const { extension: extFromMime, lookup: mimeLookup } = mime;

function logStep(obj) { console.error(JSON.stringify(obj)); }
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const IMPORT_RE  = /@import\s+(?:url\()?["']?([^"')]+)["']?\)?[^;]*;/gi;

function normalizeUrl(input) {
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return u.toString();
  } catch { throw new Error(`Invalid URL: ${input}`); }
}
function folderNameFromUrl(urlStr) {
  const { hostname } = new URL(urlStr);
  const root = (hostname || 'site').replace(/^www\./i, '');
  return (root.split('.')[0] || 'site');
}
async function uniqueFolderName(base) {
  let name = base, i = 1;
  while (true) { try { await fs.access(name); name = `${base}-${i++}`; } catch { return name; } }
}
const sha1Short = s => crypto.createHash('sha1').update(s).digest('hex').slice(0,8);
const sanitize  = s => (s || 'file').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,80) || 'file';

function classifyByExtOrMime(urlStr, contentType) {
  const u = new URL(urlStr);
  const ext = path.extname(u.pathname).toLowerCase();
  const type = (contentType || mimeLookup(ext || '') || '').toString();
  const isJS   = ext === '.js' || /javascript|ecmascript/.test(type);
  const isFont = ['.woff','.woff2','.ttf','.otf','.eot'].includes(ext) || /font|opentype|woff/.test(type);
  const isImg  = ['.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.bmp','.avif'].includes(ext) || /image\//.test(type);
  if (isJS) return 'js';
  if (isFont) return 'fonts';
  if (isImg) return 'img';
  return 'other';
}
function ensureExt(urlStr, contentType) {
  const u = new URL(urlStr);
  const ext = path.extname(u.pathname);
  if (ext) return ext;
  const m = extFromMime(contentType || '');
  if (m) return `.${m}`;
  if (/image\//.test(contentType || '')) return '.img';
  if (/javascript/.test(contentType || '')) return '.js';
  if (/font|woff|opentype/.test(contentType || '')) return '.woff';
  return '.bin';
}

function axiosClient({ ua, timeoutMs, referer }) {
  const baseHeaders = {
    'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    ...(referer ? { Referer: referer, Origin: new URL(referer).origin } : {})
  };
  const client = axios.create({
    headers: baseHeaders,
    timeout: timeoutMs || 20000,
    maxRedirects: 5,
    decompress: true,
    validateStatus: () => true
  });
  return client;
}

async function fetchHTML(url, client) {
  const res = await client.get(url, { responseType: 'text', headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
  if (res.status < 200 || res.status >= 300) throw new Error(`Non-OK HTTP status ${res.status} for ${url}`);
  const finalUrl = res.request?.res?.responseUrl || url;
  const html = String(res.data || '');
  if (!html) throw new Error(`Empty HTML from ${finalUrl}`);
  return { html, finalUrl, contentType: res.headers['content-type'] || '' };
}
async function fetchText(url, client) {
  const res = await client.get(url, { responseType: 'text', headers: { Accept: '*/*' } });
  if (res.status < 200 || res.status >= 300) throw new Error(`Non-OK HTTP ${res.status} for ${url}`);
  return { text: String(res.data || ''), finalUrl: res.request?.res?.responseUrl || url, contentType: res.headers['content-type'] || '' };
}
async function fetchBinary(url, client) {
  const res = await client.get(url, { responseType: 'arraybuffer', headers: { Accept: '*/*' } });
  if (res.status < 200 || res.status >= 300) throw new Error(`Non-OK HTTP ${res.status} for ${url}`);
  return { buf: Buffer.from(res.data), finalUrl: res.request?.res?.responseUrl || url, contentType: res.headers['content-type'] || '' };
}

// ==== CSS helpers ====
function rewriteCssUrlsToAbs(css, cssFileUrl, collect) {
  return css.replace(CSS_URL_RE, (m,q,p) => {
    const val = (p||'').trim();
    if (/^(data:|#|blob:)/i.test(val)) return `url(${val})`;
    try { const abs = new URL(val, cssFileUrl).toString(); collect && collect.add(abs); return `url(${abs})`; }
    catch { return m; }
  });
}
async function inlineCssImports(css, cssUrl, client, depth, visited, collect) {
  if (depth <= 0) return css;
  let out = css; IMPORT_RE.lastIndex = 0;
  const tasks = []; const fallbacks = [];
  let m;
  while ((m = IMPORT_RE.exec(css)) !== null) {
    const raw = m[0], href = m[1];
    try {
      const abs = new URL(href, cssUrl).toString();
      if (visited.has(abs)) { fallbacks.push({ raw, rep: `/* @import skipped (visited): ${abs} */` }); continue; }
      visited.add(abs);
      tasks.push((async () => {
        try {
          const { text, finalUrl } = await fetchText(abs, client);
          let rewritten = rewriteCssUrlsToAbs(text, finalUrl, collect);
          rewritten = await inlineCssImports(rewritten, finalUrl, client, depth-1, visited, collect);
          return { raw, rep: `/* @import inlined from ${finalUrl} */\n${rewritten}\n/* end import */` };
        } catch (e) { return { raw, rep: `/* @import failed: ${abs} (${e.message}) */` }; }
      })());
    } catch { fallbacks.push({ raw, rep: `/* @import skipped (bad URL): ${href} */` }); }
  }
  const results = (await Promise.all(tasks)).concat(fallbacks);
  for (const r of results) out = out.replace(r.raw, r.rep);
  return out;
}

async function collectCssAndAssets(stylesheetUrls, inlineBlocks, client) {
  const visited = new Set();
  const cssAssets = new Set();
  const parts = [];

  for (const cssUrl of stylesheetUrls) {
    try {
      const { text, finalUrl, contentType } = await fetchText(cssUrl, client);
      if (!/text\/css|; ?charset=/i.test(contentType) && !finalUrl.endsWith('.css')) { parts.push(`/* Skipped non-CSS ${finalUrl} */`); continue; }
      let css = rewriteCssUrlsToAbs(text, finalUrl, cssAssets);
      css = await inlineCssImports(css, finalUrl, client, 2, visited, cssAssets);
      parts.push(`/* ===== CSS from ${finalUrl} ===== */\n${css}\n`);
    } catch (e) { parts.push(`/* Failed CSS ${cssUrl}: ${e.message} */`); }
  }

  for (const { css, baseUrl } of inlineBlocks) {
    let rew = rewriteCssUrlsToAbs(css, baseUrl, cssAssets);
    rew = await inlineCssImports(rew, baseUrl, client, 1, visited, cssAssets);
    parts.push(`/* ===== Inline <style> from ${baseUrl} ===== */\n${rew}\n`);
  }

  return { cssText: parts.join('\n'), cssAssetUrls: Array.from(cssAssets) };
}

// ==== HTML scraping & rewrite ====
function extractStyles(html, baseUrl) {
  const $ = load(html);
  const links = new Set();
  $('link[rel~="stylesheet"][href], link[rel="preload"][as="style"][href]').each((_,el)=>{
    const raw = $(el).attr('href'); if (!raw) return;
    try { links.add(new URL(raw, baseUrl).toString()); } catch {}
  });
  const inline = [];
  $('style').each((_,el)=>{ const css = $(el).html() || ''; if (css.trim()) inline.push(css); });
  return { stylesheetUrls: Array.from(links), inlineCssBlocks: inline };
}

function parseNoscriptAssets($, baseUrl, addAbs) {
  $('noscript').each((_, el) => {
    const html = $(el).html();
    if (!html) return;
    const _$ = load(html);
    _$('img[src], source[src]').each((__, n) => {
      const u = _$(n).attr('src'); if (u) { try { addAbs(new URL(u, baseUrl).toString()); } catch {} }
    });
    _$$('[srcset]').each((__, n) => {
      const s = _$(n).attr('srcset'); if (!s) return;
      s.split(',').forEach(item => {
        const u = item.trim().split(/\s+/)[0];
        if (u) { try { addAbs(new URL(u, baseUrl).toString()); } catch {} }
      });
    });
  });
}

function collectHtmlAssetUrls(html, baseUrl) {
  const $ = load(html);
  const assets = new Set();
  const addAbs = u => { try { assets.add(new URL(u, baseUrl).toString()); } catch {} };

  // Standard attrs
  $('img[src], video[src], audio[src], source[src], script[src], link[rel*="icon"][href], link[rel="apple-touch-icon"][href], link[as="image"][href], link[rel="manifest"][href]')
    .each((_,el)=> addAbs($(el).attr('src') || $(el).attr('href')));

  // srcset
  $('[srcset]').each((_, el) => {
    const s = $(el).attr('srcset'); if (!s) return;
    s.split(',').forEach(item => { const u = item.trim().split(/\s+/)[0]; if (u) addAbs(u); });
  });

  // data-src / data-srcset / data-original / data-lazy
  $('[data-src], [data-original], [data-lazy], [data-srcset]').each((_, el) => {
    const ds = $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('data-lazy');
    if (ds) addAbs(ds);
    const dss = $(el).attr('data-srcset');
    if (dss) dss.split(',').forEach(item => { const u = item.trim().split(/\s+/)[0]; if (u) addAbs(u); });
  });

  // inline styles url(...)
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    style.replace(CSS_URL_RE, (m,q,p)=>{ const v=(p||'').trim(); if (/^(data:|#|blob:)/i.test(v)) return m; addAbs(v); return m; });
  });

  // noscript fallbacks
  parseNoscriptAssets($, baseUrl, addAbs);

  return { $, assetUrls: Array.from(assets) };
}

function rewriteHtmlReferencesToLocal($, baseUrl, urlToLocalRel) {
  const setLocal = (el, attr) => {
    const v = $(el).attr(attr); if (!v) return;
    try { const abs = new URL(v, baseUrl).toString(); const loc = urlToLocalRel.get(abs); if (loc) $(el).attr(attr, loc); } catch {}
  };

  $('img[src], video[src], audio[src], source[src]').each((_, el) => setLocal(el, 'src'));
  $('script[src]').each((_, el) => setLocal(el, 'src'));
  $('link[rel*="icon"][href], link[rel="apple-touch-icon"][href], link[as="image"][href], link[rel="manifest"][href]').each((_, el) => setLocal(el, 'href'));

  // If data-src existed, adopt it to src when local is present
  $('[data-src], [data-original], [data-lazy]').each((_, el) => {
    const raw = $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('data-lazy');
    try {
      const abs = new URL(raw, baseUrl).toString();
      const loc = urlToLocalRel.get(abs);
      if (loc && !$(el).attr('src')) $(el).attr('src', loc);
    } catch {}
  });

  // srcset & data-srcset
  const rewriteSrcset = (selector, attr) => {
    $(selector).each((_, el) => {
      const old = $(el).attr(attr); if (!old) return;
      const rew = old.split(',').map(item => {
        const [u, d] = item.trim().split(/\s+/, 2);
        let out = u;
        try { const abs = new URL(u, baseUrl).toString(); const loc = urlToLocalRel.get(abs); if (loc) out = loc; } catch {}
        return d ? `${out} ${d}` : out;
      }).join(', ');
      $(el).attr(attr, rew);
    });
  };
  rewriteSrcset('[srcset]', 'srcset');
  rewriteSrcset('[data-srcset]', 'data-srcset');

  // inline styles
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const rew = style.replace(CSS_URL_RE, (m,q,p) => {
      const v = (p||'').trim(); if (/^(data:|#|blob:)/i.test(v)) return m;
      try { const abs = new URL(v, baseUrl).toString(); const loc = urlToLocalRel.get(abs); if (loc) return `url(${loc})`; } catch {}
      return m;
    });
    $(el).attr('style', rew);
  });

  // refresh stylesheet references -> local style.css
  $('link[rel~="stylesheet"]').remove();
  $('style').remove();
  if ($('head').length === 0) $('html').prepend('<head></head>');
  $('head').append('<link rel="stylesheet" href="style.css">');

  return $.html();
}

// ==== Asset saving ====
function localPathForAsset(remoteUrl, contentType) {
  const u = new URL(remoteUrl);
  const folder = classifyByExtOrMime(remoteUrl, contentType);
  const base = sanitize(path.basename(u.pathname).replace(/\.[^.]+$/, '')) || 'file';
  const ext  = ensureExt(remoteUrl, contentType);
  const name = `${base}-${sha1Short(remoteUrl)}${ext}`;
  return path.posix.join('assets', folder, name);
}
async function ensureDir(fileAbs) { await fs.mkdir(path.dirname(fileAbs), { recursive: true }); }

async function downloadWithConcurrency(urls, client, limit, verbose=false) {
  const out = new Array(urls.length);
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const url = urls[idx];
      try {
        const { buf, finalUrl, contentType } = await fetchBinary(url, client);
        out[idx] = { ok:true, url, finalUrl, contentType, buf };
        if (verbose) console.error(`[asset OK] ${finalUrl} (${buf.length}B)`);
      } catch (e) {
        out[idx] = { ok:false, url, error: e.message };
        if (verbose) console.error(`[asset FAIL] ${url} :: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, urls.length || 1) }, worker));
  return out;
}

// ==== CLI glue ====
function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { url: null, outdir: null, ua: null, timeout: null, concurrency: 8, verbose: false };
  for (let i=0;i<args.length;i++) {
    const a = args[i];
    if (!a.startsWith('--') && !flags.url) { flags.url = a; continue; }
    if (a === '--outdir') { flags.outdir = args[++i]; continue; }
    if (a === '--ua') { flags.ua = args[++i]; continue; }
    if (a === '--timeout') { flags.timeout = Number(args[++i]); continue; }
    if (a === '--concurrency') { flags.concurrency = Math.max(1, Number(args[++i]) || 8); continue; }
    if (a === '--verbose' || a === '-v') { flags.verbose = true; continue; }
    if (a === '--help' || a === '-h') { printHelpAndExit(); }
  }
  if (!flags.url) printHelpAndExit('Missing URL');
  return flags;
}
function printHelpAndExit(msg) {
  if (msg) console.error(`\nError: ${msg}\n`);
  console.error(`Usage:
  clone-site.mjs <url> [--outdir folder] [--ua "User-Agent"] [--timeout ms] [--concurrency N] [--verbose]

Examples:
  node clone-site.mjs www.google.com
  node clone-site.mjs https://news.ycombinator.com --verbose
  node clone-site.mjs example.com --outdir example --timeout 30000 --concurrency 12
`);
  process.exit(msg ? 1 : 0);
}

(async function main(){
  const { url: rawUrl, outdir, ua, timeout, concurrency, verbose } = parseArgs(process.argv);

  logStep({ step:"START", content:`Clone HTML+CSS+assets for ${rawUrl}` });
  let url;
  try { url = normalizeUrl(rawUrl); }
  catch (e) { logStep({ step:"OUTPUT", content:`Invalid URL: ${e.message}` }); process.exit(1); }

  const folder = await uniqueFolderName(outdir || folderNameFromUrl(url));
  const client = axiosClient({ ua, timeoutMs: timeout, referer: url });

  // 1) HTML
  logStep({ step:"TOOL", tool_name:"fetchHTML", input: JSON.stringify({ url }) });
  let page;
  try {
    page = await fetchHTML(url, client);
    logStep({ step:"OBSERVE", content:`Fetched HTML ${page.finalUrl} (len=${page.html.length})` });
  } catch (e) { logStep({ step:"OUTPUT", content:`Failed to fetch HTML: ${e.message}` }); process.exit(1); }

  // 2) Styles
  const { stylesheetUrls, inlineCssBlocks } = extractStyles(page.html, page.finalUrl);
  const inlineTagged = inlineCssBlocks.map(css => ({ css, baseUrl: page.finalUrl }));

  // 3) HTML assets (incl. noscript/data-src)
  const { $, assetUrls: htmlAssetUrls } = collectHtmlAssetUrls(page.html, page.finalUrl);

  // 4) CSS + CSS assets
  logStep({ step:"TOOL", tool_name:"fetchCSS", input: JSON.stringify({ count: stylesheetUrls.length }) });
  const { cssText, cssAssetUrls } = await collectCssAndAssets(stylesheetUrls, inlineTagged, client);
  logStep({ step:"OBSERVE", content:`CSS collected: external=${stylesheetUrls.length}, inline=${inlineTagged.length}, cssAssets=${cssAssetUrls.length}` });

  // 5) All assets
  const allAssetUrls = Array.from(new Set([...htmlAssetUrls, ...cssAssetUrls].filter(u => /^https?:\/\//.test(u))));
  logStep({ step:"THINK", content:`Total assets detected: ${allAssetUrls.length}` });

  await fs.mkdir(folder, { recursive: true });

  // 6) Download assets WITH referer
  logStep({ step:"TOOL", tool_name:"downloadAssets", input: JSON.stringify({ count: allAssetUrls.length, concurrency }) });
  const results = await downloadWithConcurrency(allAssetUrls, client, concurrency, verbose);

  const urlToLocalRel = new Map();
  let ok = 0, fail = 0;
  for (const r of results) {
    if (!r || !r.ok) { fail++; continue; }
    const localRel = localPathForAsset(r.finalUrl || r.url, r.contentType);
    urlToLocalRel.set(r.finalUrl || r.url, localRel);
    urlToLocalRel.set(r.url, localRel);
    const abs = path.join(folder, localRel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, r.buf);
    ok++;
  }
  logStep({ step:"OBSERVE", content:`Assets saved: ${ok}, failed: ${fail}` });

  // 7) Rewrite CSS url(...) -> local
  let localCss = cssText;
  for (const [remote, localRel] of urlToLocalRel.entries()) {
    // replace exact remote strings; avoids clobbering other URLs
    localCss = localCss.split(remote).join(localRel);
  }

  // 8) Rewrite HTML references -> local + link style.css
  const finalHtml = rewriteHtmlReferencesToLocal($, page.finalUrl, urlToLocalRel);

  // 9) Write files
  await fs.writeFile(path.join(folder, 'index.html'), finalHtml, 'utf8');
  await fs.writeFile(path.join(folder, 'style.css'), localCss, 'utf8');

  logStep({ step:"OUTPUT", content:`Saved site to ${folder}/ (index.html, style.css, assets/*)` });
})();
