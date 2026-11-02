import https from 'https';
import net, { AddressInfo } from 'net';
import { requestTimeoutMs, watchForResume, DEFAULT_REQUEST_TIMEOUT_SECONDS, IDLE_SOCKET_MS } from '../connectionHealth';
import { buildHttpsAgent } from '../tls';
import { CookieHttpClient } from '../cookieHttpClient';

describe('requestTimeoutMs', () => {
  it('defaults when unset, empty, negative or not a number', () => {
    const def = DEFAULT_REQUEST_TIMEOUT_SECONDS * 1000;
    expect(requestTimeoutMs({})).toBe(def);
    expect(requestTimeoutMs({ SAP_REQUEST_TIMEOUT_SECONDS: '' })).toBe(def);
    expect(requestTimeoutMs({ SAP_REQUEST_TIMEOUT_SECONDS: '-5' })).toBe(def);
    expect(requestTimeoutMs({ SAP_REQUEST_TIMEOUT_SECONDS: 'soon' })).toBe(def);
  });

  it('reads seconds, and 0 switches the timeout off', () => {
    expect(requestTimeoutMs({ SAP_REQUEST_TIMEOUT_SECONDS: '120' })).toBe(120_000);
    expect(requestTimeoutMs({ SAP_REQUEST_TIMEOUT_SECONDS: '0' })).toBeUndefined();
  });
});

describe('watchForResume', () => {
  function harness() {
    let t = 0;
    let tick: () => void = () => {};
    const cleared: any[] = [];
    const onResume = jest.fn();
    const stop = watchForResume(onResume, {
      intervalMs: 10_000, thresholdMs: 60_000, now: () => t,
      setInterval: (fn) => { tick = fn; return { unref: () => {} }; },
      clearInterval: (h) => cleared.push(h),
    });
    return { advance: (ms: number) => { t += ms; tick(); }, onResume, stop, cleared };
  }

  it('stays quiet while ticks arrive on time or a little late', () => {
    const h = harness();
    h.advance(10_000);
    h.advance(25_000);
    h.advance(10_000);
    expect(h.onResume).not.toHaveBeenCalled();
  });

  it('reports a tick that fired far later than scheduled, with the gap', () => {
    const h = harness();
    h.advance(10_000);
    h.advance(30 * 60_000);
    expect(h.onResume).toHaveBeenCalledTimes(1);
    expect(h.onResume).toHaveBeenCalledWith(30 * 60_000 - 10_000);
    h.advance(10_000);
    expect(h.onResume).toHaveBeenCalledTimes(1);
  });

  it('stop clears the timer', () => {
    const h = harness();
    h.stop();
    expect(h.cleared).toHaveLength(1);
  });
});

describe('agent and client timeouts', () => {
  it('the destination agent closes idle sockets', () => {
    const agent = buildHttpsAgent(undefined, false);
    expect((agent as any).options.timeout).toBe(IDLE_SOCKET_MS);
    agent.destroy();
  });

  // A TCP server that accepts the connection and never writes a byte (not even
  // the TLS handshake): the shape of a socket that died while the machine slept.
  async function silentServer(): Promise<{ url: string; close: () => void }> {
    const sockets: net.Socket[] = [];
    const tcp = net.createServer((s) => { sockets.push(s); });
    await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
    const port = (tcp.address() as AddressInfo).port;
    return { url: `https://127.0.0.1:${port}`, close: () => { sockets.forEach((s) => s.destroy()); tcp.close(); } };
  }

  it('a cookie-client request that receives nothing fails after the timeout instead of hanging', async () => {
    const srv = await silentServer();
    const agent = new https.Agent({ keepAlive: true });
    const client = new CookieHttpClient(srv.url, [], true, undefined, agent, 300);
    const started = Date.now();
    await expect(client.request({ url: '/sap/bc/adt/discovery' })).rejects.toThrow(/timeout/i);
    expect(Date.now() - started).toBeLessThan(5_000);
    agent.destroy();
    srv.close();
  });

  it('destroying the agent ends a request in flight and the agent stays usable', async () => {
    const srv = await silentServer();
    const agent = new https.Agent({ keepAlive: true });
    const client = new CookieHttpClient(srv.url, [], true, undefined, agent);
    const pending = client.request({ url: '/sap/bc/adt/discovery' });
    await new Promise((r) => setTimeout(r, 100));
    agent.destroy();
    await expect(pending).rejects.toThrow();
    // A fresh request on the same agent opens a new socket (and times out here).
    const again = new CookieHttpClient(srv.url, [], true, undefined, agent, 200);
    await expect(again.request({ url: '/x' })).rejects.toThrow(/timeout/i);
    agent.destroy();
    srv.close();
  });
});
