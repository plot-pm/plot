import { describe, expect, it } from 'vitest';
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
  it('refetches once for a burst of events inside the window', () => {
    const source = fakeSource();
    let clock = 10_000;
    let refetches = 0;
    listenForEvents({ open: () => source, refetch: () => (refetches += 1), now: () => clock });
    for (let i = 0; i < 5; i += 1) {
      source.onmessage?.({ data: '{}' });
      clock += 300;
    }
    expect(refetches).toBe(1);
  });

  it('refetches again once the window has passed', () => {
    const source = fakeSource();
    let clock = 10_000;
    let refetches = 0;
    listenForEvents({ open: () => source, refetch: () => (refetches += 1), now: () => clock });
    source.onmessage?.({});
    clock += 2_000;
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
