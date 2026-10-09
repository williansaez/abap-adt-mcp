import { checkNode, checkBrowser, probe, runSelfCheck } from '../selfCheck';
import type { SystemConfig } from '../systems';

jest.mock('puppeteer-core', () => ({}));

describe('selfCheck', () => {
  it('accepts Node 22.12 and newer only', () => {
    expect(checkNode('22.11.0').level).toBe('fail');
    expect(checkNode('22.12.0').level).toBe('ok');
    expect(checkNode('24.1.0').level).toBe('ok');
    expect(checkNode('20.18.0').text).toMatch(/full path of npx/);
  });

  it('asks for a browser only when a destination uses sso', () => {
    const basic: SystemConfig = { name: 'B', url: 'https://b.invalid', authType: 'basic', user: 'u', password: 'p' };
    const sso: SystemConfig = { name: 'S', url: 'https://s.invalid', authType: 'sso' };
    expect(checkBrowser([basic], {})).toBeUndefined();
    expect(checkBrowser([sso], { SAP_BROWSER_PATH: '/nonexistent/chrome' })).toMatchObject({ level: 'fail' });
  });

  it('names the cause when a destination does not answer', async () => {
    const line = await probe({ name: 'X', url: 'https://127.0.0.1:1', authType: 'basic', user: 'u', password: 'p' }, 2000);
    expect(line.level).toBe('fail');
    expect(line.text).toMatch(/X: .*ECONNREFUSED.*port/);
  });

  it('fails with the setup text when no systems file exists', async () => {
    const out: string[] = [];
    const code = await runSelfCheck('9.9.9', { SAP_SYSTEMS_FILE: '/nonexistent/systems.json' }, (l) => out.push(l));
    expect(code).toBe(1);
    expect(out[0]).toBe('abap-adt-mcp 9.9.9 self-check');
    expect(out.join('\n')).toMatch(/FAIL {2}No ABAP systems configured: \/nonexistent\/systems\.json/);
  });
});
