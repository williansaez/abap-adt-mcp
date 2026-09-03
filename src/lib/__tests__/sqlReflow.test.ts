import { reflowSql, tokenizeSql, dataPreviewHint } from '../sqlReflow';

describe('reflowSql', () => {
  it('leaves short statements untouched and wraps long ones at token boundaries', () => {
    expect(reflowSql('SELECT a FROM t')).toEqual({ sql: 'SELECT a FROM t', reflowed: false });
    const cols = Array.from({ length: 16 }, (_, i) => `PurchasingInfoRecordVeryLongColumnName${i}`).join(', ');
    const sql = `SELECT ${cols} FROM I_PurgInfoRecdPriceCndnAPI01 WHERE Material = '100001' AND Plant = '6775'`;
    const r = reflowSql(sql);
    expect(r.reflowed).toBe(true);
    for (const line of r.sql.split('\n')) expect(line.length).toBeLessThanOrEqual(200);
    expect(r.sql.replace(/\s+/g, ' ')).toBe(sql.replace(/\s+/g, ' '));
  });

  it('keeps string literals whole and refuses tokens beyond the line limit', () => {
    const lit = `'${'x'.repeat(150)}'`;
    const sql = `SELECT a, b, c FROM t WHERE x = ${lit} AND y = ${lit}`;
    expect(tokenizeSql(sql)).toContain(lit);
    const r = reflowSql(sql);
    expect(r.sql.split('\n').every(l => l.length <= 200)).toBe(true);
    expect(r.sql).toContain(lit);
    expect(() => reflowSql(`SELECT a FROM t WHERE x = '${'y'.repeat(300)}'`)).toThrow(/longer than 255/);
  });

  it('explains data preview refusals and truncation errors', () => {
    expect(dataPreviewHint('The use of element STATUS of Table ZX is not permitted')).toMatch(/tableContents/);
    expect(dataPreviewHint('A Boolean expression was expected in "MATERIAL".')).toMatch(/255-character/);
    expect(dataPreviewHint('something else')).toBeUndefined();
  });
});
