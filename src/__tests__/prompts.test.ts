import { listPrompts, getPrompt, PROMPTS } from '../prompts';
import fs from 'fs';
import path from 'path';

describe('prompts', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'tools.snapshot.json'), 'utf8'));
  const toolNames = new Set<string>(snapshot.tools.map((t: any) => t.name));

  it('lists six prompts with arguments', () => {
    const list = listPrompts();
    expect(list.map(p => p.name)).toEqual(['create-object', 'safe-edit', 'review-transport', 'fix-atc', 'clean-core-check', 'debug-dump']);
    for (const p of list) expect(p.arguments.length).toBeGreaterThan(0);
  });

  it('renders prompts with arguments and enforces required ones', () => {
    const p = getPrompt('safe-edit', { destination: 'DEV', object: 'ZCL_X', change: 'rename field' })!;
    expect(p.messages[0].content.text).toContain('destination="DEV"');
    expect(p.messages[0].content.text).toContain('editObjectSource');
    expect(() => getPrompt('safe-edit', {})).toThrow(/requires arguments: object, change/);
    expect(getPrompt('nope')).toBeUndefined();
  });

  it('only references tools that exist in the catalog', () => {
    const args: Record<string, string> = { destination: 'DEV', objectType: 'CLAS/OC', name: 'ZCL_X', package: 'ZPKG', object: 'ZCL_X', change: 'c', transport: 'DEVK900001', target: 'ZPKG', variant: 'V', filter: 'f', purpose: 'p' };
    for (const p of PROMPTS) {
      const text = p.render(args);
      const mentioned = [...text.matchAll(/\b([a-z][A-Za-z]+)\(/g)].map(m => m[1]);
      for (const name of mentioned) expect(toolNames.has(name)).toBe(true);
    }
  });
});
