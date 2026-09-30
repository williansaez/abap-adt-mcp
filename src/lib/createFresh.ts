/**
 * Create an object outside the stateful ADT context.
 *
 * An object created by a request that carries X-sap-adt-sessiontype: stateful
 * cannot be read in that same context: GET of the object and of its source
 * answer 400 ExceptionResourceWrongData ("wrong input data for processing")
 * until its source is written or the context ends. Observed on S/4HANA 2023
 * on-premise and on S/4HANA Cloud Public Edition, with classes. The usual
 * flow (createObject, then setObjectSource) never noticed; anything that
 * reads first (getObjectSource, objectStructure, editObjectSource,
 * setMethodSource) did.
 *
 * Every destination runs its ADT client stateful, so the creation is sent
 * as a stateless request instead. ADT treats a stateless request on the
 * stateful session like dropSession: the context and every lock it held
 * are gone. That is harmless when the ledger is empty and unacceptable when
 * it is not, so with locks held the creation stays stateful and the caller
 * is told what that means for the new object.
 */
import { session_types } from 'abap-adt-api';
import { listLocks } from './lockLedger.js';

export interface CreationOutcome<T> {
  result: T;
  /** Session type the creation request carried. */
  context: 'stateless' | 'stateful';
  /** Object URLs whose locks kept the creation inside the stateful context. */
  locksHeld: string[];
  /** Present when the object is unreadable in this session for now. */
  note?: string;
}

type SessionClient = { stateful: any } & object;

export async function createOutsideStatefulContext<T>(client: SessionClient, create: () => Promise<T>): Promise<CreationOutcome<T>> {
  const locksHeld = listLocks(client).map(l => l.objectUrl);
  if (locksHeld.length) {
    const result = await create();
    return {
      result, context: 'stateful', locksHeld,
      note: `Created inside the stateful session because ${locksHeld.length} lock(s) are held (${locksHeld.join(', ')}). Until its source is written with setObjectSource, or the locks are released and dropSession is called, reading the new object in this session (getObjectSource, objectStructure, editObjectSource, setMethodSource) answers 400 "wrong input data".`,
    };
  }
  const previous = client.stateful;
  client.stateful = session_types.stateless;
  try {
    const result = await create();
    return { result, context: 'stateless', locksHeld };
  } finally {
    client.stateful = previous ?? session_types.stateful;
  }
}
