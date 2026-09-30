/**
 * Language of a new object.
 *
 * abap-adt-api writes adtcore:language and adtcore:masterLanguage into the
 * creation request and falls back to "EN" when the caller names none. Its
 * positional createObject(...) cannot carry a language at all, so every object
 * used to be created with English as its original language, whatever language
 * the session was logged on in.
 *
 * Order: the language of the call, then the logon language of the destination
 * (`language` in systems.json, SAP_LANGUAGE), then nothing, which leaves the
 * library's "EN".
 */
const LANGUAGE_KEY = /^[A-Za-z]{2}$/;

export class InvalidLanguageError extends Error {}

function fromCall(name: 'language' | 'masterLanguage', value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const key = String(value).trim();
  // The library copies the value into an XML attribute as it is.
  if (!LANGUAGE_KEY.test(key)) throw new InvalidLanguageError(`${name} must be a two-letter SAP language key such as EN, DE or PT (got "${key.slice(0, 20)}")`);
  return key.toUpperCase();
}

export function creationLanguage(adtclient: { language?: unknown }, args: { language?: unknown; masterLanguage?: unknown }): { language?: string; masterLanguage?: string } {
  const masterLanguage = fromCall('masterLanguage', args?.masterLanguage);
  let language = fromCall('language', args?.language);
  if (!language) {
    const logon = String(adtclient?.language ?? '').trim();
    if (LANGUAGE_KEY.test(logon)) language = logon.toUpperCase();
  }
  return { ...(language ? { language } : {}), ...(masterLanguage ? { masterLanguage } : {}) };
}
