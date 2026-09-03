#!/usr/bin/env node
/**
 * Documentation hygiene gate, run by CI and available as `npm run docs:check`.
 *
 * The rules below are the ones a human reviewer kept having to enforce by hand:
 * no customer or tenant identifiers in a public repository, no em-dashes in
 * prose, no links that do not resolve, and no environment variable that the
 * code reads without declaring it in server.json. A failure here is a blocker,
 * not a style note.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const problems = [];
const add = (file, rule, detail) => problems.push({ file, rule, detail });

// Files that carry prose for readers. Generated files are checked too: their
// text comes from tool descriptions, which are prose as well.
const docFiles = [
  'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  ...fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f),
  ...fs.readdirSync(path.join(root, 'skills')).flatMap(d => {
    const p = path.join(root, 'skills', d, 'SKILL.md');
    return fs.existsSync(p) ? ['skills/' + d + '/SKILL.md'] : [];
  }),
].filter(f => fs.existsSync(path.join(root, f)));

// 1. Identifiers that must never reach a public repository. Tenant hosts, real
//    transport numbers and SAP user ids leak the customer a session ran against.
const IDENTIFIERS = [
  { re: /\bmy\d{6}\b/g, what: 'S/4HANA tenant host (use myXXXXXX)' },
  { re: /\b[A-Z]{2}\d[A-Z]\d{6}\b/g, what: 'transport request number (use DEVK900123)' },
  { re: /\bCB\d{10}\b/g, what: 'SAP business user id (use DEVELOPER)' },
  { re: /\bvh[a-z]{3,}[a-z0-9]*_[A-Z0-9]{3}_\d{2}\b/g, what: 'SAP application server host (use vhabap01_SID_00)' },
  { re: /adt:\/\/(?!SID\b)[A-Z0-9]{3}\//g, what: 'SAP system id in an ADT url (use adt://SID/)' },
];
// Customer names are read from a git-ignored file so the list itself is never
// committed. One name per line; missing file means the check is skipped.
const namesFile = path.join(root, '.docs-forbidden-names');
const customerNames = fs.existsSync(namesFile)
  ? fs.readFileSync(namesFile, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  : [];

for (const f of docFiles) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  for (const { re, what } of IDENTIFIERS) {
    for (const m of text.matchAll(re)) add(f, 'identifier', `${m[0]}: ${what}`);
  }
  for (const name of customerNames) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(text)) add(f, 'identifier', `customer name "${name}"`);
  }
  // 2. Em-dashes: the project writes with commas, colons and full stops.
  const dashes = (text.match(/—/g) || []).length;
  if (dashes) add(f, 'em-dash', `${dashes} occurrence(s)`);
  // 3. Relative links must resolve.
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const file = target.split('#')[0];
    if (!file) continue;
    if (!fs.existsSync(path.resolve(root, path.dirname(f), file))) add(f, 'link', target);
  }
}

// 4. Every MCP_/SAP_ variable the code reads must be declared in server.json,
//    which is what the MCP registry and hosts show to users.
const serverJson = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8'));
const declared = new Set((serverJson.packages?.[0]?.environmentVariables || []).map(e => e.name));
const srcFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
    else if (e.name.endsWith('.ts')) srcFiles.push(p);
  }
})(path.join(root, 'src'));
const KNOWN_EXTERNAL = new Set(['NODE_TLS_REJECT_UNAUTHORIZED']);
const used = new Set();
for (const p of srcFiles) {
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/\benv\.((?:MCP|SAP)_[A-Z0-9_]+)/g)) used.add(m[1]);
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/process\.env\.((?:MCP|SAP)_[A-Z0-9_]+)/g)) used.add(m[1]);
}
for (const name of [...used].sort()) {
  if (!declared.has(name) && !KNOWN_EXTERNAL.has(name)) add('server.json', 'undeclared-env', name);
}

// 5. Commit messages are their own surface. A history rewrite that replaced
//    only file contents left customer names in two commit subjects, so the
//    same identifiers are checked against the messages being added.
try {
  const { execSync } = require('child_process');
  const range = process.env.DOCS_CHECK_RANGE || 'origin/main..HEAD';
  const git = (args) => execSync(`git log --format=%H%n%B ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let log = '';
  try { log = git(range); } catch { log = git('-20'); }
  for (const { re, what } of IDENTIFIERS) {
    for (const m of log.matchAll(re)) add('commit message', 'identifier', `${m[0]}: ${what}`);
  }
  for (const name of customerNames) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(log)) add('commit message', 'identifier', `customer name "${name}"`);
  }
} catch { /* not a git checkout */ }

if (problems.length) {
  console.error(`Documentation hygiene: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p.rule.padEnd(16)} ${p.file}: ${p.detail}`);
  console.error('\nFix these before committing. See CONTRIBUTING.md.');
  process.exit(1);
}
console.log(`Documentation hygiene: ${docFiles.length} files, ${used.size} environment variables, no problems.`);
