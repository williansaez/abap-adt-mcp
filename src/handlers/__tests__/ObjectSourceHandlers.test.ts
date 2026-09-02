import { ObjectSourceHandlers } from '../ObjectSourceHandlers';

const URL = '/sap/bc/adt/oo/classes/zcl_demo/source/main';

function makeHandler(initialSource: string) {
  const client: any = {
    stateful: 'stateless',
    source: initialSource,
    getObjectSource: jest.fn(async () => client.source),
    setObjectSource: jest.fn(async (_url: string, source: string) => { client.source = source; })
  };
  return { client, handler: new ObjectSourceHandlers(client) };
}

const parse = (r: any) => JSON.parse(r.content[0].text);

describe('editObjectSource', () => {
  it('replaces an inclusive line range and writes the result back with the lock handle', async () => {
    const { client, handler } = makeHandler('a\nb\nc\nd');
    const res = parse(await handler.handle('editObjectSource', {
      objectSourceUrl: URL, startLine: 2, endLine: 3, newText: 'B\nC2\nC3', lockHandle: 'LH', transport: 'TR1'
    }));
    expect(client.source).toBe('a\nB\nC2\nC3\nd');
    expect(client.setObjectSource).toHaveBeenCalledWith(URL, 'a\nB\nC2\nC3\nd', 'LH', 'TR1');
    expect(client.stateful).toBe('stateful');
    expect(res).toMatchObject({ updated: true, totalLinesBefore: 4, totalLinesAfter: 5, linesReplaced: 2, linesInserted: 3 });
  });

  it('inserts without deleting when endLine = startLine - 1', async () => {
    const { client, handler } = makeHandler('a\nb');
    await handler.handle('editObjectSource', { objectSourceUrl: URL, startLine: 2, endLine: 1, newText: 'x', lockHandle: 'LH' });
    expect(client.source).toBe('a\nx\nb');
  });

  it('deletes the range when newText is empty', async () => {
    const { client, handler } = makeHandler('a\nb\nc');
    await handler.handle('editObjectSource', { objectSourceUrl: URL, startLine: 2, endLine: 2, newText: '', lockHandle: 'LH' });
    expect(client.source).toBe('a\nc');
  });

  it('rejects the edit when expectedText does not match the current SAP content', async () => {
    const { client, handler } = makeHandler('a\nb\nc');
    await expect(handler.handle('editObjectSource', {
      objectSourceUrl: URL, startLine: 2, endLine: 2, newText: 'z', expectedText: 'stale', lockHandle: 'LH'
    })).rejects.toThrow(/expectedText did not match/);
    expect(client.setObjectSource).not.toHaveBeenCalled();
  });

  it('always reads the current source from SAP, not the cache', async () => {
    const { client, handler } = makeHandler('a\nb');
    await handler.handle('getObjectSource', { objectSourceUrl: URL });
    client.source = 'a\nchanged';
    await handler.handle('editObjectSource', { objectSourceUrl: URL, startLine: 1, endLine: 1, newText: 'A', lockHandle: 'LH' });
    expect(client.source).toBe('A\nchanged');
  });

  it('validates line arguments', async () => {
    const { handler } = makeHandler('a');
    await expect(handler.handle('editObjectSource', { objectSourceUrl: URL, startLine: 0, endLine: 0, newText: '', lockHandle: 'LH' })).rejects.toThrow(/startLine/);
    await expect(handler.handle('editObjectSource', { objectSourceUrl: URL, startLine: 5, endLine: 5, newText: '', lockHandle: 'LH' })).rejects.toThrow(/beyond the end/);
  });
});

describe('editObjectSource replacements', () => {
  it('applies a unique text anchor and writes back with lock handle and transport', async () => {
    const { client, handler } = makeHandler('METHOD a.\n  x = 1.\nENDMETHOD.');
    const res = parse(await handler.handle('editObjectSource', {
      objectSourceUrl: URL, lockHandle: 'LH', transport: 'TR1',
      replacements: JSON.stringify([{ oldText: '  x = 1.', newText: '  x = 2.\n  y = 3.' }])
    }));
    expect(client.source).toBe('METHOD a.\n  x = 2.\n  y = 3.\nENDMETHOD.');
    expect(client.setObjectSource).toHaveBeenCalledWith(URL, client.source, 'LH', 'TR1');
    expect(res).toMatchObject({ mode: 'replacements', replacementsApplied: 1, totalLinesBefore: 3, totalLinesAfter: 4 });
    expect(res.applied[0]).toMatchObject({ line: 2, linesRemoved: 1, linesAdded: 2 });
  });

  it('accepts an already-parsed array and applies several replacements in order', async () => {
    const { client, handler } = makeHandler('a\nb\nc');
    await handler.handle('editObjectSource', {
      objectSourceUrl: URL, lockHandle: 'LH',
      replacements: [{ oldText: 'a', newText: 'A' }, { oldText: 'c', newText: '' }]
    });
    expect(client.source).toBe('A\nb\n');
  });

  it('rejects an anchor with zero matches without writing', async () => {
    const { client, handler } = makeHandler('a\nb');
    await expect(handler.handle('editObjectSource', {
      objectSourceUrl: URL, lockHandle: 'LH', replacements: [{ oldText: 'zzz', newText: 'y' }]
    })).rejects.toThrow(/0 matches/);
    expect(client.setObjectSource).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous anchor and reports the candidate lines', async () => {
    const { client, handler } = makeHandler('x = 1.\ny = 2.\nx = 1.');
    await expect(handler.handle('editObjectSource', {
      objectSourceUrl: URL, lockHandle: 'LH', replacements: [{ oldText: 'x = 1.', newText: 'x = 9.' }]
    })).rejects.toThrow(/2 locations \(lines 1, 3\)/);
    expect(client.setObjectSource).not.toHaveBeenCalled();
  });

  it('is atomic: a failing later entry leaves the object untouched', async () => {
    const { client, handler } = makeHandler('a\nb');
    await expect(handler.handle('editObjectSource', {
      objectSourceUrl: URL, lockHandle: 'LH',
      replacements: [{ oldText: 'a', newText: 'A' }, { oldText: 'nope', newText: '' }]
    })).rejects.toThrow(/replacements\[1\]/);
    expect(client.source).toBe('a\nb');
  });

  it('matches LF anchors against CRLF sources', async () => {
    const { client, handler } = makeHandler('a\r\nb\r\nc');
    await handler.handle('editObjectSource', {
      objectSourceUrl: URL, lockHandle: 'LH', replacements: [{ oldText: 'a\nb', newText: 'ab' }]
    });
    expect(client.source).toBe('ab\nc');
  });

  it('still requires the line-range trio when replacements is absent', async () => {
    const { handler } = makeHandler('a');
    await expect(handler.handle('editObjectSource', { objectSourceUrl: URL, lockHandle: 'LH', startLine: 1 }))
      .rejects.toThrow(/either "replacements"/);
  });
});

describe('getObjectSource version', () => {
  it('passes version=inactive through as ObjectSourceOptions', async () => {
    const { client, handler } = makeHandler('a');
    await handler.handle('getObjectSource', { objectSourceUrl: URL, version: 'inactive' });
    expect(client.getObjectSource).toHaveBeenCalledWith(URL, { version: 'inactive' });
  });

  it('sends no options when version is omitted', async () => {
    const { client, handler } = makeHandler('a');
    await handler.handle('getObjectSource', { objectSourceUrl: URL });
    expect(client.getObjectSource).toHaveBeenCalledWith(URL, undefined);
  });
});

describe('getObjectSource paging', () => {
  it('returns the whole source when no paging is requested', async () => {
    const { handler } = makeHandler('a\nb\nc');
    const res = parse(await handler.handle('getObjectSource', { objectSourceUrl: URL }));
    expect(res).toMatchObject({ source: 'a\nb\nc', totalLines: 3, hasMore: false });
  });

  it('pages with startLine/maxLines', async () => {
    const { handler } = makeHandler('a\nb\nc\nd');
    const res = parse(await handler.handle('getObjectSource', { objectSourceUrl: URL, startLine: 2, maxLines: 2 }));
    expect(res).toMatchObject({ source: 'b\nc', startLine: 2, returnedLines: 2, hasMore: true });
  });
});
