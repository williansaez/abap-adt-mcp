import { ObjectSourceHandlers } from '../ObjectSourceHandlers';

const URL = '/sap/bc/adt/oo/classes/zcl_demo/source/main';

function makeHandler(initialSource: string) {
  const client: any = {
    stateful: 'stateless',
    source: initialSource,
    getObjectSource: jest.fn(async () => client.source),
    setObjectSource: jest.fn(async (_url: string, source: string) => { client.source = source; }),
    lock: jest.fn(async () => ({ LOCK_HANDLE: 'AUTO1' })),
    unLock: jest.fn(async () => undefined),
    activate: jest.fn(async () => ({ success: true, messages: [] }))
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

describe('auto-lock writes', () => {
  it('setObjectSource without lockHandle locks, writes, unlocks', async () => {
    const { client, handler } = makeHandler('old');
    const res = parse(await handler.handle('setObjectSource', { objectSourceUrl: URL, source: 'new', transport: 'TR1' }));
    expect(client.lock).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_demo', undefined);
    expect(client.setObjectSource).toHaveBeenCalledWith(URL, 'new', 'AUTO1', 'TR1');
    expect(client.unLock).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/zcl_demo', 'AUTO1');
    expect(res).toMatchObject({ updated: true, lockMode: 'auto' });
    expect(res.activation).toBeUndefined();
  });

  it('activate=true activates after the write and returns the result', async () => {
    const { client, handler } = makeHandler('a\nb');
    const res = parse(await handler.handle('editObjectSource', { objectSourceUrl: URL, replacements: [{ oldText: 'a', newText: 'A' }], activate: true }));
    expect(client.activate).toHaveBeenCalledWith('ZCL_DEMO', '/sap/bc/adt/oo/classes/zcl_demo');
    expect(res.activation).toMatchObject({ success: true });
    expect(res.lockMode).toBe('auto');
  });

  it('activation errors are reported, not thrown', async () => {
    const { client, handler } = makeHandler('a');
    client.activate.mockRejectedValueOnce(new Error('Syntax error in line 3'));
    const res = parse(await handler.handle('setObjectSource', { objectSourceUrl: URL, source: 'x', activate: true }));
    expect(res.updated).toBe(true);
    expect(res.activation).toMatchObject({ success: false });
    expect(res.activation.error).toMatch(/Syntax error/);
  });

  it('explicit lockHandle is used as before and the lock is kept', async () => {
    const { client, handler } = makeHandler('a');
    const res = parse(await handler.handle('setObjectSource', { objectSourceUrl: URL, source: 'x', lockHandle: 'LH' }));
    expect(client.lock).not.toHaveBeenCalled();
    expect(client.unLock).not.toHaveBeenCalled();
    expect(res.lockMode).toBe('explicit');
  });
});

describe('getMethodSource / setMethodSource', () => {
  const CLS = 'CLASS zcl_demo DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_demo IMPLEMENTATION.\n  METHOD a.\n    x = 1.\n  ENDMETHOD.\n  METHOD b.\n    y = 2.\n  ENDMETHOD.\nENDCLASS.';

  it('returns one method block by class name and lists methods when missing', async () => {
    const { client, handler } = makeHandler(CLS);
    const res = parse(await handler.handle('getMethodSource', { classUrl: 'ZCL_DEMO', methodName: 'b' }));
    expect(client.getObjectSource).toHaveBeenCalledWith(URL);
    expect(res).toMatchObject({ method: 'B', startLine: 7, endLine: 9, lines: 3 });
    expect(res.source).toBe('  METHOD b.\n    y = 2.\n  ENDMETHOD.');
    const miss = await handler.handle('getMethodSource', { classUrl: URL, methodName: 'zzz', include: 'testclasses' });
    expect(miss.isError).toBe(true);
    expect(client.getObjectSource).toHaveBeenLastCalledWith('/sap/bc/adt/oo/classes/zcl_demo/includes/testclasses');
  });

  it('replaces only the method, wrapping a bare body, under an automatic lock', async () => {
    const { client, handler } = makeHandler(CLS);
    const res = parse(await handler.handle('setMethodSource', { classUrl: 'zcl_demo', methodName: 'A', source: '    x = 42.', transport: 'TR1', activate: true }));
    expect(client.source).toBe('CLASS zcl_demo DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_demo IMPLEMENTATION.\n  METHOD a.\n    x = 42.\n  ENDMETHOD.\n  METHOD b.\n    y = 2.\n  ENDMETHOD.\nENDCLASS.');
    expect(client.setObjectSource).toHaveBeenCalledWith(URL, client.source, 'AUTO1', 'TR1');
    expect(res).toMatchObject({ method: 'A', bodyWrapped: true, lockMode: 'auto', replaced: { startLine: 4, endLine: 6 }, now: { startLine: 4, endLine: 6 } });
    expect(res.activation.success).toBe(true);
    await expect(handler.handle('setMethodSource', { classUrl: 'zcl_demo', methodName: 'nope', source: 'x.' })).rejects.toThrow(/Methods present: A, B/);
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

describe('getObjectSource URL handling', () => {
  const { ObjectSourceHandlers } = require('../ObjectSourceHandlers');
  const parse = (r: any) => JSON.parse(r.content[0].text);
  it('strips /source/main from class include URLs and retries a bare object URL that answers metadata', async () => {
    const calls: string[] = [];
    const client: any = {
      getObjectSource: jest.fn(async (url: string) => {
        calls.push(url);
        if (url === '/sap/bc/adt/oo/classes/zcl_a/includes/implementations') return 'CLASS lcl IMPLEMENTATION. ENDCLASS.';
        if (url === '/sap/bc/adt/applicationjob/templates/zjob') return '<?xml version="1.0"?><blue:source xmlns:blue="x"/>';
        if (url === '/sap/bc/adt/applicationjob/templates/zjob/source/main') return '{"className":"ZCL_JOB"}';
        throw new Error('Not Found');
      }),
    };
    const h = new ObjectSourceHandlers(client);
    const inc = parse(await h.handle('getObjectSource', { objectSourceUrl: '/sap/bc/adt/oo/classes/zcl_a/includes/implementations/source/main' }));
    expect(inc.source).toContain('lcl');
    expect(inc.note).toMatch(/without \/source\/main/);
    const job = parse(await h.handle('getObjectSource', { objectSourceUrl: '/sap/bc/adt/applicationjob/templates/zjob' }));
    expect(job.source).toContain('ZCL_JOB');
    expect(job.objectSourceUrl).toBe('/sap/bc/adt/applicationjob/templates/zjob/source/main');
    expect(calls).toEqual(['/sap/bc/adt/oo/classes/zcl_a/includes/implementations', '/sap/bc/adt/applicationjob/templates/zjob', '/sap/bc/adt/applicationjob/templates/zjob/source/main']);
  });
});
