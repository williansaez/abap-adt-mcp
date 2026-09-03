/**
 * MCP progress notifications for long-running tools. The dispatcher opens a
 * progress context per call (when the client sent a progressToken); handlers
 * call reportProgress() at meaningful steps, and a heartbeat keeps hosts from
 * timing out during long SAP calls. Without a token everything is a no-op.
 */
import { AsyncLocalStorage } from 'async_hooks';

export type ProgressSink = (params: { progress: number; total?: number; message?: string }) => Promise<void> | void;

export interface ProgressReporter {
  report(message: string, progress?: number, total?: number): void;
  /** Last message, so the heartbeat can repeat it. */
  lastMessage?: string;
  count: number;
}

const storage = new AsyncLocalStorage<ProgressReporter>();

export function createReporter(sink: ProgressSink): ProgressReporter {
  const reporter: ProgressReporter = {
    count: 0,
    report(message, progress, total) {
      reporter.count += 1;
      reporter.lastMessage = message;
      const p = progress ?? reporter.count;
      Promise.resolve(sink({ progress: p, total, message })).catch(() => { /* client gone */ });
    },
  };
  return reporter;
}

/** Run fn with a reporter available to reportProgress() calls underneath. */
export function withProgress<T>(reporter: ProgressReporter | undefined, fn: () => Promise<T>): Promise<T> {
  return reporter ? storage.run(reporter, fn) : fn();
}

/** Report a step; silently ignored when the current call has no progress token. */
export function reportProgress(message: string, progress?: number, total?: number): void {
  storage.getStore()?.report(message, progress, total);
}

/** Emit "still running" progress every intervalMs while fn is pending. */
export async function withHeartbeat<T>(reporter: ProgressReporter | undefined, label: string, fn: () => Promise<T>, intervalMs = 10_000): Promise<T> {
  if (!reporter) return fn();
  const started = Date.now();
  const timer = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    reporter.report(`${label} still running (${secs}s)${reporter.lastMessage && !reporter.lastMessage.includes('still running') ? `: ${reporter.lastMessage}` : ''}`);
  }, intervalMs);
  timer.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
