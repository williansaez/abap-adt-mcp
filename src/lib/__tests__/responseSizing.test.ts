import { shrinkToFit, hardTruncateJson, SAFE_OUTPUT_CHARS } from '../responseSizing';

describe('responseSizing', () => {
  it('defaults the budget to 40000 chars', () => {
    expect(SAFE_OUTPUT_CHARS).toBe(40_000);
  });

  it('returns the exact original payload when it already fits', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ i }));
    const text = shrinkToFit(rows.length, (count, capped) => ({ status: 'success', capped, rows: rows.slice(0, count) }));
    expect(JSON.parse(text)).toEqual({ status: 'success', capped: false, rows });
  });

  it('shrinks the page until the payload fits and flags it as capped', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ i, text: 'x'.repeat(100) }));
    const text = shrinkToFit(rows.length, (count, capped) => ({ capped, returned: count, rows: rows.slice(0, count) }));
    const parsed = JSON.parse(text);
    expect(text.length).toBeLessThanOrEqual(SAFE_OUTPUT_CHARS);
    expect(parsed.capped).toBe(true);
    expect(parsed.returned).toBeGreaterThan(0);
    expect(parsed.returned).toBeLessThan(rows.length);
    expect(parsed.rows).toHaveLength(parsed.returned);
  });

  it('falls back to a hard cut when a single item is itself too large', () => {
    const blob = 'y'.repeat(SAFE_OUTPUT_CHARS * 2);
    const text = shrinkToFit(1, () => ({ source: blob }));
    const parsed = JSON.parse(text);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalChars).toBeGreaterThan(SAFE_OUTPUT_CHARS);
    expect(text.length).toBeLessThanOrEqual(SAFE_OUTPUT_CHARS);
  });

  it('hardTruncateJson passes small payloads through untouched', () => {
    expect(JSON.parse(hardTruncateJson({ a: 1 }))).toEqual({ a: 1 });
  });

  it('honours MCP_MAX_RESPONSE_CHARS and rejects values below the floor', () => {
    const original = process.env.MCP_MAX_RESPONSE_CHARS;
    const load = () => {
      let value = 0;
      jest.isolateModules(() => { value = require('../responseSizing').SAFE_OUTPUT_CHARS; });
      return value;
    };
    try {
      process.env.MCP_MAX_RESPONSE_CHARS = '120000';
      expect(load()).toBe(120_000);
      process.env.MCP_MAX_RESPONSE_CHARS = '10';
      const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(load()).toBe(40_000);
      warn.mockRestore();
    } finally {
      if (original === undefined) delete process.env.MCP_MAX_RESPONSE_CHARS;
      else process.env.MCP_MAX_RESPONSE_CHARS = original;
    }
  });
});
