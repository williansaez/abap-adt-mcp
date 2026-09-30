import { session_types } from 'abap-adt-api';
import { listLocks, releaseAll, clearLedger } from './lockLedger.js';

/**
 * Run a class with a fresh program load. A stateful ADT session keeps the
 * load of a class it already executed, so after a write + activate the same
 * session still runs the old code (observed live on S/4HANA Cloud: runClass
 * printed the previous output although the active source and the activation
 * result were current).
 *
 * Two strategies, in order of preference:
 *  - `clone`: a separate stateless ADTClient (abap-adt-api's statelessClone),
 *    available when the client owns a password or bearer fetcher (basic,
 *    oauth). The stateful session and its locks stay untouched.
 *  - `stateless`: sending a stateless request on the stateful session itself.
 *    ADT treats that exactly like dropSession, which terminates the stateful
 *    context and with it every lock it held, so explicit locks are released
 *    first (best effort) and reported in `locksInvalidated`. This is the only
 *    option for cookie/SSO clients, which cannot be cloned.
 */
export interface FreshRunResult {
  output: string;
  mode: 'clone' | 'stateless';
  /** Object URLs whose explicit locks were released because the stateful session had to be reset. */
  locksInvalidated: string[];
}

type FreshClient = { stateful: any; runClass(name: string): Promise<string>; statelessClone?: { runClass(name: string): Promise<string> } } & Record<string, any>;

export async function runClassFresh(client: FreshClient, className: string): Promise<FreshRunResult> {
  let clone: { runClass(name: string): Promise<string> } | undefined;
  try { clone = client.statelessClone; } catch { clone = undefined; }
  if (clone && clone !== (client as any)) {
    return { output: await clone.runClass(className), mode: 'clone', locksInvalidated: [] };
  }

  const held = listLocks(client).map(l => l.objectUrl);
  if (held.length) {
    await releaseAll(client as any);
    clearLedger(client);
  }
  const previous = client.stateful;
  client.stateful = session_types.stateless;
  try {
    const output = await client.runClass(className);
    return { output, mode: 'stateless', locksInvalidated: held };
  } finally {
    client.stateful = previous ?? session_types.stateful;
  }
}

/**
 * What the class runner answers when it runs a class whose activation it does
 * not see yet. Observed live on an on-prem S/4HANA (PCE 2023): runClass right
 * after activate printed this, and the same call a few seconds later ran fine.
 */
export const CLASSRUN_NOT_READY = /does not implement if_oo_adt_classrun~main/i;

/**
 * runClassFresh, retried while the runner still reports the class as not
 * implementing IF_OO_ADT_CLASSRUN~MAIN. `notReady` is true when every attempt
 * got that answer, so the caller can report an error instead of the text.
 */
export async function runClassWhenReady(
  client: FreshClient,
  className: string,
  delaysMs: number[] = [1000, 2000, 4000],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise(r => setTimeout(r, ms))
): Promise<FreshRunResult & { attempts: number; notReady: boolean }> {
  let run = await runClassFresh(client, className);
  let attempts = 1;
  for (const delay of delaysMs) {
    if (!CLASSRUN_NOT_READY.test(run.output)) break;
    await sleep(delay);
    const next = await runClassFresh(client, className);
    run = { ...next, locksInvalidated: [...run.locksInvalidated, ...next.locksInvalidated] };
    attempts++;
  }
  return { ...run, attempts, notReady: CLASSRUN_NOT_READY.test(run.output) };
}
