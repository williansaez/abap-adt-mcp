import { normalizeQueryResult } from '../queryDecode';

const result = (type: unknown, values: unknown[]) => ({
  columns: [{ name: 'V', type, description: 'd', keyAttribute: false, colType: '', isKeyFigure: false, length: 10 }],
  values: values.map(v => ({ V: v })),
});
const values = (r: any) => r.values.map((row: any) => row.V);

describe('normalizeQueryResult, raw (the default)', () => {
  it('moves the trailing minus of a numeric column to the front and changes nothing else', () => {
    expect(values(normalizeQueryResult(result('P', ['12.34-', '-12.34', '12.34', '0.00', '1234567890123456.78-', ' 7- ']), false)))
      .toEqual(['-12.34', '-12.34', '12.34', '0.00', '-1234567890123456.78', '-7']);
    expect(values(normalizeQueryResult(result('I', ['5-', '5', '-5']), false))).toEqual(['-5', '5', '-5']);
    expect(values(normalizeQueryResult(result('F', ['1.5E-03', '1.5E+02-']), false))).toEqual(['1.5E-03', '-1.5E+02']);
  });

  it('keeps NUMC, character, date and time columns exactly as SAP sent them', () => {
    expect(values(normalizeQueryResult(result('N', ['000010', '12345678901234567890', '000000']), false))).toEqual(['000010', '12345678901234567890', '000000']);
    expect(values(normalizeQueryResult(result('C', ['0001', 'A-', ' x', '']), false))).toEqual(['0001', 'A-', ' x', '']);
    expect(values(normalizeQueryResult(result('D', ['20260929', '00000000', '']), false))).toEqual(['20260929', '00000000', '']);
    expect(values(normalizeQueryResult(result('T', ['235959']), false))).toEqual(['235959']);
  });

  it('reads the type whatever the XML parser made of it, and leaves non-strings alone', () => {
    // fast-xml-parser hands the INT8 type "8" over as the number 8.
    expect(values(normalizeQueryResult(result(8, ['5-']), false))).toEqual(['-5']);
    expect(values(normalizeQueryResult(result('P', [undefined, null, 3]), false))).toEqual([undefined, null, 3]);
    expect(normalizeQueryResult({ columns: [], values: [] }, false)).toEqual({ columns: [], values: [] });
    expect(normalizeQueryResult(undefined as any, false)).toBeUndefined();
  });

  it('does not touch the object it was given', () => {
    const input = result('P', ['12.34-']);
    normalizeQueryResult(input, false);
    expect(input.values[0].V).toBe('12.34-');
  });
});

describe('normalizeQueryResult, decode=true', () => {
  it('turns a numeric value into a number only when the number is exact', () => {
    expect(values(normalizeQueryResult(result('P', ['12.34-', '12.34', '0.10', '100']), true))).toEqual([-12.34, 12.34, 0.1, 100]);
    expect(values(normalizeQueryResult(result('P', ['1234567890123456.78', '1234567890123456.78-']), true))).toEqual(['1234567890123456.78', '-1234567890123456.78']);
    expect(values(normalizeQueryResult(result('8', ['9007199254740991', '9007199254740993', '5-']), true))).toEqual([9007199254740991, '9007199254740993', -5]);
    expect(values(normalizeQueryResult(result('F', ['1.5E+02', '1.5E-03-']), true))).toEqual([150, -0.0015]);
    expect(values(normalizeQueryResult(result('P', ['1,234.56', 'abc', '']), true))).toEqual(['1,234.56', 'abc', '']);
  });

  it('never turns NUMC into a number: leading zeros are part of the value', () => {
    expect(values(normalizeQueryResult(result('N', ['000010', '2026']), true))).toEqual(['000010', '2026']);
  });

  it('formats a valid date and keeps an initial or impossible one as sent', () => {
    expect(values(normalizeQueryResult(result('D', ['20260929', '00000000', '20261301', '20260230', '']), true)))
      .toEqual(['2026-09-29', '00000000', '20261301', '20260230', '']);
  });
});
