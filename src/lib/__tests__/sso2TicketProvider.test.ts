import { getSso2Cookies } from '../sso2TicketProvider';

const config = (script: string, timeoutMs = 5_000) => ({
  command: process.execPath,
  args: ['-e', script],
  timeoutMs,
});

describe('SSO2 ticket provider', () => {
  it('turns the provider JSON into an in-memory MYSAPSSO2 cookie', async () => {
    await expect(getSso2Cookies(config(
      `process.stdout.write(JSON.stringify({ticket:'temporary-ticket'}))`
    ))).resolves.toEqual([{ name: 'MYSAPSSO2', value: 'temporary-ticket' }]);
  });

  it('does not expose provider stdout or stderr when the command fails', async () => {
    const liveTicket = 'do-not-leak-this-ticket';
    const promise = getSso2Cookies(config(
      `process.stdout.write('${liveTicket}'); process.stderr.write('${liveTicket}'); process.exit(7)`
    ));
    await expect(promise).rejects.toThrow(/provider failed \(exit 7\)/);
    await promise.catch((error) => expect(String(error)).not.toContain(liveTicket));
  });

  it('rejects malformed JSON, missing tickets and unsafe cookie values', async () => {
    await expect(getSso2Cookies(config(`process.stdout.write('not-json')`))).rejects.toThrow(/invalid JSON/);
    await expect(getSso2Cookies(config(`process.stdout.write('{}')`))).rejects.toThrow(/no ticket/);
    await expect(getSso2Cookies(config(
      `process.stdout.write(JSON.stringify({ticket:'bad;cookie'}))`
    ))).rejects.toThrow(/invalid cookie value/);
    await expect(getSso2Cookies(config(
      `process.stdout.write(JSON.stringify({ticket:'bad cookie'}))`
    ))).rejects.toThrow(/invalid cookie value/);
  });

  it('terminates a provider that exceeds its configured timeout', async () => {
    await expect(getSso2Cookies(config(`setTimeout(() => {}, 5000)`, 1_000))).rejects.toThrow(/provider failed \(timeout\)/);
  });
});
