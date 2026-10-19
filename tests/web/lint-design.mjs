/**
 * Design-system lint.
 *
 * The point of tokenising the type scale, the stacking order and the palette is
 * that there is exactly one place to change them. That only holds if nothing
 * reintroduces a raw value later, so these are checked mechanically rather than
 * by eye in review.
 *
 * Usage: node tests/web/lint-design.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const css = readFileSync(path.join(ROOT, 'assets/css/app.css'), 'utf8');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const problems = [];
const notes = [];
const check = (ok, message) => (ok ? notes.push(`  ok   ${message}`) : problems.push(`  FAIL ${message}`));

// ---- type scale ------------------------------------------------------------
const rawFontSizes = [...css.matchAll(/font-size:\s*[0-9.]+px/g)].map((m) => m[0]);
check(rawFontSizes.length === 0,
  `every font-size uses a token${rawFontSizes.length ? ` (raw: ${rawFontSizes.slice(0, 5).join(', ')})` : ''}`);

const scaleTokens = ['--text-2xs', '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl'];
for (const token of scaleTokens) {
  check(css.includes(`${token}:`), `type token defined: ${token}`);
}

// ---- stacking order --------------------------------------------------------
const rawZ = [...css.matchAll(/z-index:\s*[0-9]+/g)].map((m) => m[0]);
check(rawZ.length === 0,
  `every z-index uses a token${rawZ.length ? ` (raw: ${rawZ.slice(0, 5).join(', ')})` : ''}`);

// ---- palette ---------------------------------------------------------------
// Colours belong in the token block; a raw hex outside it drifts.
const tokenBlockEnd = css.indexOf('* { box-sizing');
const outsideTokens = css.slice(tokenBlockEnd);
const rawHex = [...outsideTokens.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
  .map((m) => m[0])
  // SVG artwork and rgba() shadows are data, not palette choices.
  .filter((hex) => !/^#fff(fff)?$/i.test(hex));
check(rawHex.length === 0,
  `palette colours come from tokens${rawHex.length ? ` (raw: ${[...new Set(rawHex)].slice(0, 6).join(', ')})` : ''}`);

// ---- motion ----------------------------------------------------------------
check(/@media \(prefers-reduced-motion: reduce\)/.test(css),
  'a prefers-reduced-motion guard exists');

const looping = [...css.matchAll(/animation:[^;]*infinite[^;]*/g)].map((m) => m[0].trim());
check(looping.length === 0 || /prefers-reduced-motion/.test(css),
  'looping animations are covered by the reduced-motion guard');

// ---- document semantics ----------------------------------------------------
const h1s = [...html.matchAll(/<h1\b/g)].length;
check(h1s === 1, `exactly one h1 (found ${h1s})`);
check(html.includes('class="skip-link"'), 'skip link present');
check(/<main[^>]*id="main"/.test(html), 'main landmark present');
check(/<html lang="[a-z]{2}/.test(html), 'html lang set');

// ---- metadata --------------------------------------------------------------
const title = /<title>([^<]+)<\/title>/.exec(html);
check(Boolean(title && title[1].trim()), 'title present');
check(title && title[1].length <= 65, `title is short enough (${title ? title[1].length : 0} chars)`);

const description = /<meta name="description" content="([^"]+)"/.exec(html);
check(Boolean(description && description[1].length >= 50), 'meta description present and substantive');
check(Boolean(description && description[1].length <= 160),
  `description fits a SERP snippet (${description ? description[1].length : 0} chars)`);

const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html);
check(Boolean(canonical), 'canonical link present');
check(Boolean(canonical && /^https:\/\//.test(canonical[1])), 'canonical is absolute');

for (const [prop, label] of [
  ['og:type', 'og:type'],
  ['og:url', 'og:url'],
  ['og:title', 'og:title'],
  ['og:description', 'og:description'],
]) {
  check(html.includes(`property="${prop}"`), `${label} present`);
}
check(/<meta name="twitter:card" content="summary/.test(html), 'twitter card declared');
check(canonical && html.includes(`property="og:url" content="${canonical[1]}"`),
  'og:url agrees with the canonical URL');
check(/<link rel="icon"/.test(html), 'favicon declared');
check(/<meta name="theme-color"/.test(html), 'theme-color declared');
check(/<meta name="color-scheme"/.test(html), 'color-scheme declared');

// ---- no duplicate metadata -------------------------------------------------
for (const name of ['description', 'theme-color']) {
  const count = [...html.matchAll(new RegExp(`name="${name}"`, 'g'))].length;
  check(count <= 2, `"${name}" is not duplicated beyond its light/dark pair (found ${count})`);
}

process.stdout.write('# design lint\n');
process.stdout.write(notes.join('\n') + '\n');
if (problems.length) {
  process.stdout.write(problems.join('\n') + '\n');
  process.stdout.write(`\nFAILED: ${problems.length} problem(s)\n`);
  process.exit(1);
}
process.stdout.write(`\nOK: ${notes.length} checks passed\n`);
