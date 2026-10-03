import { clampSeekTarget, createSeekCoalescer, SEEK_INTERVAL_MS } from './seekCoalescer';

describe('clampSeekTarget', () => {
  it('ignores non-finite targets', () => {
    expect(clampSeekTarget(Number.NaN, 100)).toBeNull();
    expect(clampSeekTarget(Number.POSITIVE_INFINITY, 100)).toBeNull();
    expect(clampSeekTarget(Number.NEGATIVE_INFINITY, 100)).toBeNull();
  });
  it('clamps to [0, duration - 0.25]', () => {
    expect(clampSeekTarget(-3, 100)).toBe(0);
    expect(clampSeekTarget(42.5, 100)).toBe(42.5);
    expect(clampSeekTarget(100, 100)).toBe(99.75);
    expect(clampSeekTarget(5000, 100)).toBe(99.75);
    expect(clampSeekTarget(1, 0.1)).toBe(0);
  });
  it('only clamps the lower bound while the duration is unknown', () => {
    expect(clampSeekTarget(5000, 0)).toBe(5000);
    expect(clampSeekTarget(5000, Number.NaN)).toBe(5000);
    expect(clampSeekTarget(-1, Number.NaN)).toBe(0);
  });
});

describe('createSeekCoalescer', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-01T00:00:00Z')); });
  afterEach(() => { jest.useRealTimers(); });

  it('applies the first seek immediately', async () => {
    const apply = jest.fn();
    const seeks = createSeekCoalescer(apply);
    await expect(seeks.request(10)).resolves.toBeUndefined();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(10);
  });

  it('coalesces rapid seeks into one trailing seek with the last target', async () => {
    const apply = jest.fn();
    const seeks = createSeekCoalescer(apply);
    const first = seeks.request(10);
    const pending = [seeks.request(20), seeks.request(30), seeks.request(40)];
    let settled = false;
    void Promise.all(pending).then(() => { settled = true; });
    expect(apply.mock.calls).toEqual([[10]]);
    await first;
    jest.advanceTimersByTime(SEEK_INTERVAL_MS - 1);
    await Promise.resolve();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await Promise.all(pending);
    expect(apply.mock.calls).toEqual([[10], [40]]);
  });

  it('never issues more than one native seek per interval during a long drag', () => {
    const appliedAt: number[] = [];
    const apply = jest.fn(() => { appliedAt.push(Date.now()); });
    const seeks = createSeekCoalescer(apply);
    // 模拟每 16ms 一次的拖动事件，持续 1 秒。
    for (let elapsed = 0; elapsed < 1000; elapsed += 16) { void seeks.request(elapsed / 10); jest.advanceTimersByTime(16); }
    jest.advanceTimersByTime(SEEK_INTERVAL_MS);
    expect(appliedAt.length).toBeGreaterThanOrEqual(2);
    appliedAt.slice(1).forEach((at, index) => expect(at - appliedAt[index]).toBeGreaterThanOrEqual(SEEK_INTERVAL_MS));
    expect(apply).toHaveBeenLastCalledWith(99.2);
  });

  it('applies again immediately once the interval has passed', () => {
    const apply = jest.fn();
    const seeks = createSeekCoalescer(apply);
    void seeks.request(1);
    jest.advanceTimersByTime(SEEK_INTERVAL_MS);
    void seeks.request(2);
    expect(apply.mock.calls).toEqual([[1], [2]]);
  });

  it('rejects the waiting callers when the native seek throws', async () => {
    const failure = new Error('player released');
    const apply = jest.fn(() => { throw failure; });
    const seeks = createSeekCoalescer(apply);
    await expect(seeks.request(5)).rejects.toBe(failure);
    const later = seeks.request(6);
    jest.advanceTimersByTime(SEEK_INTERVAL_MS);
    await expect(later).rejects.toBe(failure);
  });

  it('drops the pending seek on cancel and releases its waiters', async () => {
    const apply = jest.fn();
    const seeks = createSeekCoalescer(apply);
    void seeks.request(1);
    const pending = seeks.request(2);
    seeks.cancel();
    await expect(pending).resolves.toBeUndefined();
    jest.advanceTimersByTime(SEEK_INTERVAL_MS * 4);
    expect(apply.mock.calls).toEqual([[1]]);
  });
});
