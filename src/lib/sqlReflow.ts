/**
 * The ADT data preview endpoint (/sap/bc/adt/datapreview/freestyle) reads the
 * statement into 255-character lines. A long single-line SELECT is cut at
 * byte 256, and the ABAP SQL parser then complains about the fragment it got
 * ("A Boolean expression was expected in MATERIAL", "text literal longer than
 * 255 characters", "substring access ... size 256 out of bounds"). Seen live
 * with CDS views whose field names are long. Re-flowing the statement onto
 * short lines at token boundaries avoids the cut; string literals are kept
 * whole because a literal cannot span lines.
 */
export const DATAPREVIEW_LINE_LIMIT = 255;

export function tokenizeSql(sql: string): string[] {
  const tokens: string[] = [];
  const re = /'(?:[^']|'')*'|`(?:[^`]|``)*`|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) tokens.push(m[0]);
  return tokens;
}

export function reflowSql(sql: string, maxLine = 200): { sql: string; reflowed: boolean } {
  const text = String(sql || '').replace(/\r\n/g, '\n');
  if (!text.split('\n').some(l => l.length > maxLine)) return { sql: text, reflowed: false };
  const lines: string[] = [];
  let current = '';
  for (const tok of tokenizeSql(text)) {
    if (tok.length > DATAPREVIEW_LINE_LIMIT) {
      throw new Error(`SQL token longer than ${DATAPREVIEW_LINE_LIMIT} characters cannot be sent to the data preview (${tok.slice(0, 40)}…); shorten the literal or split the condition`);
    }
    if (!current) current = tok;
    else if (current.length + 1 + tok.length <= maxLine) current += ' ' + tok;
    else { lines.push(current); current = tok; }
  }
  if (current) lines.push(current);
  return { sql: lines.join('\n'), reflowed: true };
}

/** Hint for data preview errors the agent cannot decode on its own. */
export function dataPreviewHint(message: string): string | undefined {
  const m = String(message || '');
  if (/is not permitted|não é permitid|dataMaintenance|not allowed for display|Anzeige nicht erlaubt/i.test(m)) {
    return 'The data preview refuses this table (DDIC dataMaintenance restricted or display not allowed for the API view). Use tableContents(ddicEntityName) for plain tables, or read through a released CDS view.';
  }
  if (/256|255|Boolean expression was expected|Substring access|subcpo|text literal/i.test(m)) {
    return 'The data preview reads the statement in 255-character lines. The server already wraps long statements; if this still fails, a single literal or identifier is longer than 255 characters, or the SQL has a real syntax error at the named token.';
  }
  if (/not authorized|sem autorização|no authorization|S_TABU/i.test(m)) {
    return 'The SAP user lacks display authorization for this table (S_TABU_DIS/S_TABU_NAM); retrying will not help.';
  }
  return undefined;
}
