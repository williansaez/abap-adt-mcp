#!/usr/bin/env node
/**
 * Every file that carries the release version must agree with package.json:
 * package-lock.json (root and the "" package entry), server.json (version and
 * packages[0].version), .claude-plugin/plugin.json (version, and the npx pin in
 * mcpServers args so a plugin install runs the release it ships with instead
 * of whatever npm serves as latest). With a tag name as argument (v2.0.1) the
 * tag must match as well. Exits 1 with every mismatch listed.
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

const pkg = read('package.json');
const lock = read('package-lock.json');
const server = read('server.json');
const plugin = read('.claude-plugin/plugin.json');
const v = pkg.version;
const problems = [];
const check = (what, actual) => { if (actual !== v) problems.push(`${what} = ${JSON.stringify(actual)}, package.json = ${v}`); };

check('package-lock.json version', lock.version);
check('package-lock.json packages[""].version', lock.packages && lock.packages[''] && lock.packages[''].version);
check('server.json version', server.version);
check('server.json packages[0].version', server.packages && server.packages[0] && server.packages[0].version);
check('.claude-plugin/plugin.json version', plugin.version);
const args = ((plugin.mcpServers || {})[pkg.name] || {}).args || [];
const pin = args.find((a) => a.startsWith(`${pkg.name}@`));
if (!pin) problems.push(`.claude-plugin/plugin.json mcpServers.${pkg.name}.args has no ${pkg.name}@<version> pin (found ${JSON.stringify(args)})`);
else check(`.claude-plugin/plugin.json npx pin`, pin.slice(pkg.name.length + 1));

const tag = process.argv[2];
if (tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) problems.push(`tag ${tag} is not a final release tag (vX.Y.Z)`);
  else check(`tag ${tag}`, tag.slice(1));
}

if (problems.length) {
  console.error('Version files disagree:');
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log(`Version files agree: ${v}${tag ? ` (tag ${tag})` : ''}`);
