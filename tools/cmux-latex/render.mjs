#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import katex from 'katex';
import { chromium } from 'playwright-core';

const root = path.dirname(fileURLToPath(import.meta.url));
const help = String.raw`Usage: cmux-latex [options] 'LaTeX expression'
       cat formula.tex | cmux-latex

Render one formula as an image inside a Kitty-graphics-compatible terminal.
  --file PATH       Read a single LaTeX expression from a file
  --png PATH        Save PNG instead of writing terminal graphics
  --light           Use dark text (default: light text on transparency)
  --size NUMBER     Font size in pixels (default: 24)
  --help            Show this help

Examples:
  cmux-latex '\frac{a}{b}=\sqrt{c}'
  cmux-latex '\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}'

Uses local KaTeX assets and an isolated headless Google Chrome process.
Does not automatically replace formulas printed by other applications.
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { file: { type: 'string' }, png: { type: 'string' },
      light: { type: 'boolean' }, size: { type: 'string', default: '24' },
      help: { type: 'boolean' } },
  });
  if (values.help) { process.stdout.write(help); return; }
  if (values.file && positionals.length) throw new Error('Use either --file or an expression.');
  let tex = values.file ? await fs.readFile(values.file, 'utf8')
    : positionals.length ? positionals.join(' ') : '';
  if (!values.file && !positionals.length && !process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      tex += chunk;
      if (tex.length > 32768) throw new Error('Expression exceeds 32 KiB.');
    }
  }
  tex = tex.trim();
  for (const [left, right] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']]) {
    if (tex.startsWith(left) && tex.endsWith(right) && tex.length >= left.length + right.length) {
      tex = tex.slice(left.length, -right.length).trim(); break;
    }
  }
  if (!tex) throw new Error('Provide a LaTeX expression. See --help.');
  if (tex.length > 32768) throw new Error('Expression exceeds 32 KiB.');
  if (!values.png && !process.stdout.isTTY) throw new Error('Output must be a terminal; use --png PATH to export.');
  if (!values.png && process.env.TMUX) throw new Error('Run directly in cmux; tmux passthrough is not implemented.');
  const size = Number(values.size);
  if (!Number.isFinite(size) || size < 8 || size > 96) throw new Error('--size must be between 8 and 96.');
  const html = katex.renderToString(tex, { displayMode: true, throwOnError: true,
    trust: false, maxExpand: 1000, maxSize: 20, output: 'html' });
  const dist = path.join(root, 'node_modules/katex/dist');
  let css = await fs.readFile(path.join(dist, 'katex.min.css'), 'utf8');
  const urls = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]))];
  for (const url of urls) {
    const relative = url.replace(/^['"]|['"]$/g, '');
    const data = await fs.readFile(path.join(dist, relative));
    const type = relative.endsWith('.woff2') ? 'font/woff2' : relative.endsWith('.woff') ? 'font/woff' : 'font/ttf';
    css = css.split(`url(${url})`).join(`url(data:${type};base64,${data.toString('base64')})`);
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let png;
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    await page.route('**/*', route => route.abort());
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}
      html,body{margin:0;background:transparent} #formula{display:inline-block;padding:10px;
      color:${values.light ? '#202020' : '#eeeeee'};font-size:${size}px}
      .katex-display{margin:0}</style><div id="formula">${html}</div>`);
    await page.evaluate(() => document.fonts.ready);
    const formula = page.locator('#formula');
    const box = await formula.boundingBox();
    if (!box || box.width > 8192 || box.height > 8192) throw new Error('Formula is too large to render.');
    png = await formula.screenshot({ omitBackground: true, timeout: 10000 });
  } finally { await browser.close(); }
  if (values.png) { await fs.writeFile(values.png, png); return; }
  const payload = png.toString('base64');
  for (let offset = 0; offset < payload.length; offset += 4096) {
    const chunk = payload.slice(offset, offset + 4096);
    const metadata = offset === 0 ? 'a=T,f=100,q=2,' : '';
    const more = offset + chunk.length < payload.length ? 1 : 0;
    process.stdout.write(`\x1b_G${metadata}m=${more};${chunk}\x1b\\`);
  }
  process.stdout.write('\n');
}
main().catch(error => { console.error(`cmux-latex: ${error.message}`); process.exitCode = 1; });
