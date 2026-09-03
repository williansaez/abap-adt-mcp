import { session_types } from 'abap-adt-api';

/**
 * Run a class in a stateless request. A stateful ADT session keeps the
 * program load of a class it already executed, so after a write + activate
 * the same session still runs the old code (observed live on S/4HANA Cloud:
 * runClass printed the previous output although the active source and the
 * activation result were current). A stateless request gets a fresh roll
 * area and therefore the freshly activated load.
 */
export async function runClassFresh(client: { stateful: any; runClass(name: string): Promise<string> }, className: string): Promise<string> {
  const previous = client.stateful;
  client.stateful = session_types.stateless;
  try {
    return await client.runClass(className);
  } finally {
    client.stateful = previous ?? session_types.stateful;
  }
}
