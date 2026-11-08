import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISPATCH_NOTICE_MS, dispatchNoticeShows, noteDispatched } from '../../src/app/lib/dispatch-notice.js';

describe('the dispatched notice', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('shows on one plan for five seconds, then clears itself', () => {
    expect(DISPATCH_NOTICE_MS).toBe(5_000);
    noteDispatched('alpha');
    expect(dispatchNoticeShows('alpha')).toBe(true);
    vi.advanceTimersByTime(DISPATCH_NOTICE_MS - 1);
    expect(dispatchNoticeShows('alpha')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(dispatchNoticeShows('alpha')).toBe(false);
  });

  it('does not show on another plan', () => {
    noteDispatched('alpha');
    expect(dispatchNoticeShows('beta')).toBe(false);
  });

  it('a second dispatch of the same plan restarts the wait', () => {
    noteDispatched('alpha');
    vi.advanceTimersByTime(4_000);
    noteDispatched('alpha');
    vi.advanceTimersByTime(4_000);
    expect(dispatchNoticeShows('alpha')).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(dispatchNoticeShows('alpha')).toBe(false);
  });

  it('each plan clears on its own timer', () => {
    noteDispatched('alpha');
    vi.advanceTimersByTime(3_000);
    noteDispatched('beta');
    vi.advanceTimersByTime(2_000);
    expect(dispatchNoticeShows('alpha')).toBe(false);
    expect(dispatchNoticeShows('beta')).toBe(true);
    vi.advanceTimersByTime(3_000);
    expect(dispatchNoticeShows('beta')).toBe(false);
  });
});
