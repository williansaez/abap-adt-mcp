/**
 * Values of a data preview result (tableContents, runQuery), without losing
 * anything SAP sent.
 *
 * abap-adt-api's own decoder runs every numeric column through parseFloat or
 * parseInt: "12.34-" (SAP's trailing minus) becomes 12.34, the NUMC key
 * "000010" becomes 10, a packed number beyond 15 digits is rounded and the
 * initial date becomes null. The handlers therefore always ask the library
 * for the raw result and shape the values here.
 *
 * Raw (the default): every value is the string SAP sent, except that a
 * trailing minus on a numeric column moves to the front.
 * Decoded (decode=true): a numeric value becomes a JSON number when that
 * number is exact and stays a string otherwise, NUMC stays a string, a valid
 * date becomes YYYY-MM-DD.
 */

/** ABAP type kinds of the data preview metadata that hold a signed number. */
const NUMERIC_KINDS = new Set(['P', 'F', '/', 'a', 'e', '%', 'I', 'b', '8', 's']);
const DATE_KIND = 'D';

/** Digits a double carries exactly. */
const EXACT_DIGITS = 15;

const TRAILING_MINUS = /^(\d[\d.,]*(?:[eE][+-]?\d+)?)\s*-$/;

/** "12.34-" -> "-12.34"; anything that is not a number with a trailing minus comes back unchanged. */
export function signToFront(raw: string): string {
  const m = TRAILING_MINUS.exec(raw.trim());
  return m ? `-${m[1]}` : raw;
}

function exactNumber(value: string): number | string {
  if (/^-?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value;
  }
  if (/^-?\d*\.\d+$/.test(value)) {
    const digits = value.replace(/[-.]/g, '').replace(/^0+/, '');
    return digits.length <= EXACT_DIGITS ? Number(value) : value;
  }
  if (/^-?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

function isoDate(raw: string): string {
  if (!/^\d{8}$/.test(raw) || raw === '00000000') return raw;
  const [y, m, d] = [Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), Number(raw.slice(6, 8))];
  const date = new Date(Date.UTC(y, m - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return real ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
}

export function normalizeValue(kind: string, raw: unknown, decode: boolean): unknown {
  if (typeof raw !== 'string') return raw;
  if (NUMERIC_KINDS.has(kind)) {
    const signed = signToFront(raw);
    return decode ? exactNumber(signed) : signed;
  }
  if (decode && kind === DATE_KIND) return isoDate(raw);
  return raw;
}

/** A copy of a QueryResult ({ columns, values }) with its values shaped as described above. */
export function normalizeQueryResult<T extends { columns?: any[]; values?: any[] }>(result: T, decode: boolean): T {
  if (!result || !Array.isArray(result.values) || !Array.isArray(result.columns)) return result;
  const kinds = new Map<string, string>();
  for (const c of result.columns) kinds.set(String(c?.name), String(c?.type ?? ''));
  const values = result.values.map(row => {
    if (!row || typeof row !== 'object') return row;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(kinds.get(k) ?? '', v, decode);
    return out;
  });
  return { ...result, values };
}
