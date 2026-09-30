/**
 * What the process does when something goes wrong outside a tool call.
 *
 * Node ends the process with exit code 1 on a promise rejected without a
 * handler and on an uncaught exception. For this server that means every SAP
 * session is dropped without a logoff and every lock it holds stays in SAP
 * until somebody removes it in SM12.
 *
 * - A rejection without a handler is reported and the server keeps running.
 *   It comes from a request nobody waits for any more (a logoff that SAP
 *   refused, a browser that closed), and the state of the server is intact.
 * - An uncaught exception leaves the process in an unknown state. Locks and
 *   sessions are released, within a time limit, and the process exits with 1.
 * - SIGINT and SIGTERM release locks and sessions and exit with 0.
 */
import { redactSecrets } from './redact.js';

type Emitter = {
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
};

export interface ProcessGuardOptions {
  /** Releases locks and SAP sessions. */
  close: () => Promise<void>;
  proc?: Emitter;
  log?: (line: string) => void;
  exit?: (code: number) => void;
  /** How long the release may take before the process exits anyway. */
  timeoutMs?: number;
}

const PREFIX = '[abap-adt-mcp]';

/**
 * Message and the first lines of the stack, redacted. Never the object: an
 * HTTP error carries the request with its Authorization header and cookies.
 */
export function describeFailure(reason: unknown): string {
  if (reason instanceof Error) {
    const where = String(reason.stack || '').split('\n').slice(1, 4).map(l => l.trim()).filter(Boolean).join(' < ');
    const code = typeof (reason as any).code === 'string' ? ` [${(reason as any).code}]` : '';
    return redactSecrets(`${reason.message || reason.name}${code}${where ? ` (${where})` : ''}`).slice(0, 600);
  }
  if (typeof reason === 'string') return redactSecrets(reason).slice(0, 300);
  if (reason === undefined || reason === null) return 'no reason given';
  return `a value of type ${typeof reason}`;
}

/** Installs the handlers and returns a function that removes them. */
export function installProcessGuards(options: ProcessGuardOptions): () => void {
  const proc: Emitter = options.proc ?? process;
  const log = options.log ?? ((line: string) => console.error(line));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.timeoutMs ?? 5000;

  let shuttingDown = false;
  const shutdown = async (why: string, code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${PREFIX} ${why}: releasing locks and sessions`);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        options.close().catch(() => undefined),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    exit(code);
  };

  const onRejection = (reason: unknown) => {
    log(`${PREFIX} unhandled rejection, the server keeps running: ${describeFailure(reason)}`);
  };
  const onException = (error: unknown) => { void shutdown(`uncaught exception: ${describeFailure(error)}`, 1); };
  const onSigint = () => { void shutdown('SIGINT', 0); };
  const onSigterm = () => { void shutdown('SIGTERM', 0); };

  const listeners: Array<[string, (...args: any[]) => void]> = [
    ['unhandledRejection', onRejection], ['uncaughtException', onException], ['SIGINT', onSigint], ['SIGTERM', onSigterm],
  ];
  for (const [event, listener] of listeners) proc.on(event, listener);
  return () => { for (const [event, listener] of listeners) proc.off(event, listener); };
}
