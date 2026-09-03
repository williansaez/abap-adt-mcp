import { createReporter, withProgress, reportProgress, withHeartbeat } from '../progress';

describe('progress', () => {
  it('is a no-op without a reporter and forwards steps with one', async () => {
    expect(() => reportProgress('nothing')).not.toThrow();
    const sink = jest.fn(async () => undefined);
    const reporter = createReporter(sink);
    await withProgress(reporter, async () => {
      reportProgress('step one');
      reportProgress('step two', 2, 4);
      await new Promise(r => setTimeout(r, 0));
      reportProgress('nested still sees it');
    });
    expect(sink.mock.calls.map(c => c[0])).toEqual([
      { progress: 1, total: undefined, message: 'step one' },
      { progress: 2, total: 4, message: 'step two' },
      { progress: 3, total: undefined, message: 'nested still sees it' },
    ]);
    expect(reporter.lastMessage).toBe('nested still sees it');
  });

  it('heartbeats while a long call runs and stops afterwards', async () => {
    const sink = jest.fn(async () => undefined);
    const reporter = createReporter(sink);
    reporter.report('working');
    const result = await withHeartbeat(reporter, 'unitTestRun', () => new Promise(r => setTimeout(() => r('done'), 70)), 25);
    expect(result).toBe('done');
    const beats = sink.mock.calls.filter(c => /still running/.test(c[0].message)).length;
    expect(beats).toBeGreaterThanOrEqual(2);
    expect(sink.mock.calls[1][0].message).toMatch(/unitTestRun still running \(\d+s\): working/);
    const after = sink.mock.calls.length;
    await new Promise(r => setTimeout(r, 40));
    expect(sink.mock.calls.length).toBe(after);
    expect(await withHeartbeat(undefined, 'x', async () => 1)).toBe(1);
  });
});
