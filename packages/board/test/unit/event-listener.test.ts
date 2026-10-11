import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForEvents, type EventSourceLike } from '../../src/app/lib/event-listener.js';

const fakeSource = () => {
  const source: EventSourceLike & { closed: boolean } = {
    onmessage: null,
    onerror: null,
    closed: false,
    close: () => {
      source.closed = true;
    },
  };
  return source;
};

describe('listenForEvents', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refetches once for a burst of events inside the window', () => {
    const source = fakeSource();
    let refetches = 0;
    listenForEvents({ open: () => source, refetch: () => (refetches += 1) });
    for (let i = 0; i < 5; i += 1) {
      source.onmessage?.({ data: '{}' });
      vi.advanceTimersByTime(300);
    }
    expect(refetches).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(refetches).toBe(2);
    vi.advanceTimersByTime(10_000);
    expect(refetches).toBe(2);
  });

  it('refetches once at the end of the window for an event dropped inside it', () => {
    const source = fakeSource();
    let refetches = 0;
    listenForEvents({ open: () => source, refetch: () => (refetches += 1) });
    source.onmessage?.({});
    vi.advanceTimersByTime(1_300);
    source.onmessage?.({});
    expect(refetches).toBe(1);
    vi.advanceTimersByTime(699);
    expect(refetches).toBe(1);
    vi.advanceTimersByTime(1);
    expect(refetches).toBe(2);
  });

  it('refetches nothing on the first welcome and refetches on a later one', () => {
    const source = fakeSource();
    let refetches = 0;
    listenForEvents({ open: () => source, refetch: () => (refetches += 1) });
    source.onmessage?.({ data: '{"type":"welcome"}' });
    vi.advanceTimersByTime(5_000);
    expect(refetches).toBe(0);
    source.onmessage?.({ data: '{"type":"welcome"}' });
    expect(refetches).toBe(1);
  });

  it('sends no trailing refetch after it is stopped', () => {
    const source = fakeSource();
    let refetches = 0;
    const stop = listenForEvents({ open: () => source, refetch: () => (refetches += 1) });
    source.onmessage?.({});
    source.onmessage?.({});
    stop();
    vi.advanceTimersByTime(5_000);
    expect(refetches).toBe(1);
  });

  it('refetches again once the window has passed', () => {
    const source = fakeSource();
    let refetches = 0;
    listenForEvents({ open: () => source, refetch: () => (refetches += 1) });
    source.onmessage?.({});
    vi.advanceTimersByTime(2_000);
    source.onmessage?.({});
    expect(refetches).toBe(2);
  });

  it('does not refetch on a stream error', () => {
    const source = fakeSource();
    let refetches = 0;
    listenForEvents({ open: () => source, refetch: () => (refetches += 1) });
    source.onerror?.({});
    expect(refetches).toBe(0);
  });

  it('closes the stream when stopped', () => {
    const source = fakeSource();
    const stop = listenForEvents({ open: () => source, refetch: () => undefined });
    stop();
    expect(source.closed).toBe(true);
  });
});
