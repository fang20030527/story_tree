/** 距片尾保留的秒数，避免定位到最后一帧后立即触发播放结束。 */
export const SEEK_END_MARGIN = 0.25;
/** 两次原生定位之间的最短间隔（毫秒）。 */
export const SEEK_INTERVAL_MS = 250;

/** 把定位目标限制在 [0, 时长 - 0.25]；非有限值返回 null，表示忽略这次定位。时长未知时只限制下限。 */
export function clampSeekTarget(time: number, duration: number): number | null {
  if (!Number.isFinite(time)) return null;
  const upper = Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - SEEK_END_MARGIN) : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(0, time), upper);
}

export type SeekCoalescer = {
  /** 请求定位；返回的 Promise 在包含该目标的原生定位发出后完成（被更新的目标取代时同样完成）。 */
  request: (time: number) => Promise<void>;
  /** 丢弃尚未发出的定位，并让等待中的调用方结束等待。 */
  cancel: () => void;
};

type Waiter = { resolve: () => void; reject: (error: unknown) => void };

/**
 * 合并快速连续的定位：空闲时立即执行，间隔内的请求只保留最后一个目标，
 * 每 intervalMs 最多向原生播放器发出一次定位，减少大文件远程视频反复重新缓冲。
 */
export function createSeekCoalescer(apply: (time: number) => void, intervalMs = SEEK_INTERVAL_MS): SeekCoalescer {
  let lastApplied = Number.NEGATIVE_INFINITY;
  let pending: number | null = null;
  let waiters: Waiter[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settle = (error?: unknown) => {
    const current = waiters; waiters = [];
    current.forEach(waiter => error === undefined ? waiter.resolve() : waiter.reject(error));
  };
  const flush = () => {
    timer = null;
    if (pending === null) { settle(); return; }
    const target = pending; pending = null;
    lastApplied = Date.now();
    try { apply(target); } catch (error) { settle(error); return; }
    settle();
  };
  return {
    request(time) {
      pending = time;
      const done = new Promise<void>((resolve, reject) => { waiters.push({ resolve, reject }); });
      if (!timer) {
        const wait = lastApplied + intervalMs - Date.now();
        if (wait <= 0) flush();
        else timer = setTimeout(flush, wait);
      }
      return done;
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null; pending = null;
      settle();
    },
  };
}
