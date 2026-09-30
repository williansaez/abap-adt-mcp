import { EventEmitter } from 'events';
import { installProcessGuards } from '../processGuards';

function make(opts: { close?: () => Promise<void>; timeoutMs?: number } = {}) {
  const proc = new EventEmitter();
  const lines: string[] = [];
  const exits: number[] = [];
  const close = jest.fn(opts.close ?? (async () => undefined));
  const uninstall = installProcessGuards({
    proc: proc as any, close, log: (l) => lines.push(l), exit: (c) => { exits.push(c); }, timeoutMs: opts.timeoutMs ?? 50,
  });
  const settle = () => new Promise((r) => setTimeout(r, (opts.timeoutMs ?? 50) + 30));
  return { proc, lines, exits, close, uninstall, settle };
}

describe('process guards', () => {
  it('keeps the server and its SAP sessions alive when a promise is rejected without a handler', async () => {
    const { proc, lines, exits, close, settle } = make();
    proc.emit('unhandledRejection', new Error('Request failed with status code 403'), Promise.resolve());
    await settle();
    expect(exits).toEqual([]);
    expect(close).not.toHaveBeenCalled();
    expect(lines.join('\n')).toMatch(/unhandled rejection/i);
    expect(lines.join('\n')).toMatch(/Request failed with status code 403/);
    expect(lines.join('\n')).toMatch(/keeps running/);
  });

  it('releases locks and sessions, then exits with 1, after an uncaught exception', async () => {
    const order: string[] = [];
    const { proc, lines, exits, close, settle } = make({ close: async () => { order.push('closed'); } });
    proc.emit('uncaughtException', new Error('boom'));
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['closed']);
    expect(exits).toEqual([1]);
    expect(lines.join('\n')).toMatch(/uncaught exception: boom/i);
    expect(lines.join('\n')).toMatch(/releasing locks and sessions/);
  });

  it('exits with 0 on SIGINT and SIGTERM after releasing locks and sessions', async () => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const { proc, exits, close, lines, settle } = make();
      proc.emit(signal);
      await settle();
      expect(close).toHaveBeenCalledTimes(1);
      expect(exits).toEqual([0]);
      expect(lines.join('\n')).toContain(`${signal}: releasing locks and sessions`);
    }
  });

  it('does not wait for a release that hangs, and exits even when it fails', async () => {
    const hanging = make({ close: () => new Promise<void>(() => undefined), timeoutMs: 40 });
    hanging.proc.emit('uncaughtException', new Error('boom'));
    await hanging.settle();
    expect(hanging.exits).toEqual([1]);

    const failing = make({ close: async () => { throw new Error('logoff refused'); } });
    failing.proc.emit('SIGTERM');
    await failing.settle();
    expect(failing.exits).toEqual([0]);
  });

  it('shuts down once: a second exception or signal during the release changes nothing', async () => {
    const { proc, exits, close, settle } = make({ close: () => new Promise<void>((r) => setTimeout(r, 20)) });
    proc.emit('uncaughtException', new Error('first'));
    proc.emit('uncaughtException', new Error('second'));
    proc.emit('SIGTERM');
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([1]);
  });

  it('never writes credentials, cookies or whole request objects to the log', async () => {
    const { proc, lines, settle } = make();
    const axiosLike: any = new Error('Request failed with status code 403');
    axiosLike.config = { headers: { Authorization: 'Basic ZGV2OnNlY3JldA==', Cookie: 'SAP_SESSIONID_DEV_100=abc123' }, auth: { username: 'dev', password: 'hunter2' } };
    axiosLike.response = { data: '<html>Logon Error Message</html>', headers: { 'set-cookie': ['MYSAPSSO2=ticketvalue'] } };
    proc.emit('unhandledRejection', axiosLike, Promise.resolve());
    proc.emit('unhandledRejection', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature', Promise.resolve());
    proc.emit('unhandledRejection', { password: 'hunter2' }, Promise.resolve());
    proc.emit('unhandledRejection', undefined, Promise.resolve());
    await settle();
    const log = lines.join('\n');
    for (const secret of ['ZGV2OnNlY3JldA==', 'abc123', 'hunter2', 'ticketvalue', 'eyJhbGciOiJIUzI1NiJ9.payload.signature']) expect(log).not.toContain(secret);
    expect(log).toMatch(/Request failed with status code 403/);
  });

  it('removes its listeners when uninstalled', async () => {
    const { proc, uninstall, exits, close, settle } = make();
    expect(proc.listenerCount('uncaughtException')).toBe(1);
    uninstall();
    for (const event of ['uncaughtException', 'unhandledRejection', 'SIGINT', 'SIGTERM']) expect(proc.listenerCount(event)).toBe(0);
    proc.emit('SIGTERM');
    await settle();
    expect(close).not.toHaveBeenCalled();
    expect(exits).toEqual([]);
  });
});
