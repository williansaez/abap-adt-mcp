/**
 * Keeping ADT calls from hanging after the machine was locked, slept or moved
 * networks.
 *
 * Every destination talks to SAP through a keep-alive https.Agent, and the
 * calls of a destination run one after the other in its queue. A socket that
 * died while the laptop slept (Wi-Fi or VPN dropped, a NAT or firewall forgot
 * the connection) is still in the agent's pool: no FIN or RST ever arrives, so
 * the next request is written into it and waits for an answer that never
 * comes. Without a timeout that call never ends, and every later call of the
 * destination waits behind it in the queue.
 *
 * Three measures, each enough for part of the problem:
 * - IDLE_SOCKET_MS: idle pooled sockets are closed well before a NAT, a VPN or
 *   the ICM keep-alive drops them, so a call after a pause opens a fresh one.
 *   Over HTTP the stateful ADT session lives in its cookies, not in the TCP
 *   connection, so nothing is lost with the socket.
 * - requestTimeoutMs: a request that receives nothing for that long fails as
 *   a network error instead of waiting forever (SAP_REQUEST_TIMEOUT_SECONDS).
 * - watchForResume: a timer that fires much later than scheduled means the
 *   process was suspended; every socket of every destination is then dropped,
 *   which also ends a request that was in flight when the machine went to sleep.
 */

/** Idle keep-alive sockets are closed after this long. */
export const IDLE_SOCKET_MS = 30_000;

/** Default for SAP_REQUEST_TIMEOUT_SECONDS: above the usual ICM PROCTIMEOUT, so a long ATC run or a package activation is not cut off. */
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 600;

/**
 * Socket inactivity timeout of an ADT request in milliseconds, from
 * SAP_REQUEST_TIMEOUT_SECONDS. 0 switches it off (wait forever, as before this
 * setting existed); a negative or non-numeric value falls back to the default.
 */
export function requestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.SAP_REQUEST_TIMEOUT_SECONDS;
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  const seconds = Number.isFinite(n) && n >= 0 ? n : DEFAULT_REQUEST_TIMEOUT_SECONDS;
  return seconds === 0 ? undefined : Math.round(seconds * 1000);
}

export interface ResumeWatchOptions {
  /** How often the timer ticks. */
  intervalMs?: number;
  /** How much later than scheduled a tick must fire to count as a resume. */
  thresholdMs?: number;
  /** For tests. */
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => any;
  clearInterval?: (handle: any) => void;
}

/**
 * Call onResume(gapMs) when the process was evidently suspended (system sleep,
 * hibernate, a debugger pause). Returns a function that stops the watch. The
 * timer is unref'd, so it never keeps the process alive.
 */
export function watchForResume(onResume: (gapMs: number) => void, opts: ResumeWatchOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 10_000;
  const thresholdMs = opts.thresholdMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const setI = opts.setInterval ?? setInterval;
  const clearI = opts.clearInterval ?? clearInterval;
  let last = now();
  const handle = setI(() => {
    const t = now();
    const gap = t - last - intervalMs;
    last = t;
    if (gap > thresholdMs) onResume(gap);
  }, intervalMs);
  handle.unref?.();
  return () => clearI(handle);
}
