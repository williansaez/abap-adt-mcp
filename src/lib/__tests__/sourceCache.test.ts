import { sourceCache } from '../sourceCache';

describe('sourceCache', () => {
  beforeEach(() => sourceCache.clear());

  it('is scoped per client: the same URL never leaks between destinations or sessions', () => {
    const a = {}, b = {};
    sourceCache.set(a, '/sap/bc/adt/oo/classes/zcl_x/source/main', 'A SOURCE');
    expect(sourceCache.get(a, '/sap/bc/adt/oo/classes/zcl_x/source/main')).toBe('A SOURCE');
    expect(sourceCache.get(b, '/sap/bc/adt/oo/classes/zcl_x/source/main')).toBeUndefined();
    sourceCache.clear(a);
    expect(sourceCache.get(a, '/sap/bc/adt/oo/classes/zcl_x/source/main')).toBeUndefined();
  });

  it('expires entries after the TTL and clears everything on a global clear', () => {
    const a = {};
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    sourceCache.set(a, '/u', 'S');
    expect(sourceCache.has(a, '/u')).toBe(true);
    spy.mockReturnValue(now + 5 * 60_000 + 1);
    expect(sourceCache.get(a, '/u')).toBeUndefined();
    spy.mockReturnValue(now);
    sourceCache.set(a, '/u', 'S');
    sourceCache.clear();
    expect(sourceCache.get(a, '/u')).toBeUndefined();
    spy.mockRestore();
  });
});
