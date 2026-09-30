#!/usr/bin/env node
/**
 * Builds the project site (GitHub Pages from /docs) in the three README
 * languages from one template and one strings file:
 *
 *   docs/site/template.html  +  docs/site/strings.json
 *     -> docs/index.html         (en)
 *     -> docs/pt-BR/index.html   (pt-BR)
 *     -> docs/de/index.html      (de)
 *
 * `{{key}}` in the template is replaced by strings[lang][key]; `{{base}}` is the
 * relative path back to /docs ("" or "../"), `{{lang}}` the BCP 47 tag, and
 * `{{langNav}}` the language selector. A key missing in one language fails the
 * build, so a new string has to exist in all three before the site changes.
 * Run with `npm run site:build`; CI does not run it, commit the output.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'docs/site/template.html'), 'utf8');
const strings = JSON.parse(fs.readFileSync(path.join(root, 'docs/site/strings.json'), 'utf8'));

const LANGS = [
  { tag: 'en', dir: '', label: 'English', short: 'EN' },
  { tag: 'pt-BR', dir: 'pt-BR/', label: 'Português (Brasil)', short: 'PT' },
  { tag: 'de', dir: 'de/', label: 'Deutsch', short: 'DE' },
];
const SITE = 'https://williansaez.github.io/abap-adt-mcp/';

const keys = new Set([...template.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map(m => m[1]));
const reserved = new Set(['base', 'lang', 'langNav', 'alternates', 'canonical']);
let failed = false;
for (const { tag } of LANGS) {
  for (const k of keys) {
    if (reserved.has(k)) continue;
    if (!(k in strings[tag])) { console.error(`strings.json: "${tag}" lacks "${k}"`); failed = true; }
  }
  for (const k of Object.keys(strings[tag])) {
    if (!keys.has(k)) console.warn(`strings.json: "${tag}"."${k}" is not used by the template`);
  }
}
if (failed) process.exit(1);

for (const lang of LANGS) {
  const base = lang.dir ? '../' : '';
  const langNav = LANGS.map(l => l.tag === lang.tag
    ? `<span class="cur" lang="${l.tag}" aria-current="page">${l.short}</span>`
    : `<a href="${base}${l.dir}" lang="${l.tag}" hreflang="${l.tag}" title="${l.label}">${l.short}</a>`).join('');
  const alternates = LANGS.map(l => `<link rel="alternate" hreflang="${l.tag}" href="${SITE}${l.dir}" />`).join('\n  ')
    + `\n  <link rel="alternate" hreflang="x-default" href="${SITE}" />`;
  let html = template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, k) => {
    if (k === 'base') return base;
    if (k === 'lang') return lang.tag;
    if (k === 'langNav') return langNav;
    if (k === 'alternates') return alternates;
    if (k === 'canonical') return SITE + lang.dir;
    return strings[lang.tag][k];
  });
  const out = path.join(root, 'docs', lang.dir, 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`wrote docs/${lang.dir}index.html (${lang.tag}, ${html.length} bytes)`);
}
