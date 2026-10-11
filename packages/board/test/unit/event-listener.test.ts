import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForEvents, openSharedEventSource, type EventSourceLike } from '../../src/app/lib/event-listener.js';

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

  it('refetches on the first welcome it hears when that arrives after the window', () => {
    const source = fakeSource();
    let refetches = 0;
    listenForEvents({ open: () => source, refetch: () => (refetches += 1) });
    vi.advanceTimersByTime(5_000);
    source.onmessage?.({ data: '{"type":"welcome"}' });
    expect(refetches).toBe(1);
  });

  it('reschedules a trailing refetch whose timer fires before the clock reaches the window end', () => {
    const source = fakeSource();
    let refetches = 0;
    let lag = 0;
    listenForEvents({ open: () => source, now: () => Date.now() - lag, refetch: () => (refetches += 1) });
    source.onmessage?.({});
    vi.advanceTimersByTime(100);
    source.onmessage?.({});
    lag = 500;
    vi.advanceTimersByTime(1_900);
    expect(refetches).toBe(1);
    vi.advanceTimersByTime(500);
    expect(refetches).toBe(2);
    vi.advanceTimersByTime(10_000);
    expect(refetches).toBe(2);
  });

  it('refetches once for an event that arrives after the window end while the trailing timer is pending', () => {
    const source = fakeSource();
    let refetches = 0;
    let lead = 0;
    listenForEvents({ open: () => source, now: () => Date.now() + lead, refetch: () => (refetches += 1) });
    source.onmessage?.({});
    vi.advanceTimersByTime(100);
    source.onmessage?.({});
    lead = 2_000;
    source.onmessage?.({});
    expect(refetches).toBe(2);
    vi.advanceTimersByTime(10_000);
    expect(refetches).toBe(2);
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

/** A browser's `EventSource`, `BroadcastChannel` and Web Locks, held in one place per test. */
const fakeBrowser = () => {
  const sources: (EventSourceLike & { closed: boolean })[] = [];
  const channels: { name: string; onmessage: ((event: unknown) => void) | null }[] = [];
  const holders = new Map<string, Promise<unknown>>();
  class FakeEventSource {
    onmessage: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    closed = false;
    constructor() {
      sources.push(this);
    }
    close(): void {
      this.closed = true;
    }
  }
  class FakeBroadcastChannel {
    onmessage: ((event: unknown) => void) | null = null;
    constructor(readonly name: string) {
      channels.push(this);
    }
    postMessage(data: unknown): void {
      for (const other of channels) if (other !== this && other.name === this.name) other.onmessage?.({ data });
    }
    close(): void {
      channels.splice(channels.indexOf(this), 1);
    }
  }
  // Grants a lock to one callback at a time, in request order, the next once the
  // held callback's promise settles.
  const locks = {
    request: (name: string, callback: () => unknown): Promise<unknown> => {
      const granted = (holders.get(name) ?? Promise.resolve()).then(() => callback());
      holders.set(name, granted.then(() => undefined, () => undefined));
      return granted;
    },
  };
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  vi.stubGlobal('navigator', { locks });
  return { sources };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('openSharedEventSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens one stream for two pages and relays its messages to the other', async () => {
    const { sources } = fakeBrowser();
    const first = openSharedEventSource();
    const second = openSharedEventSource();
    const heard: unknown[][] = [[], []];
    first.onmessage = (event) => heard[0].push((event as { data: unknown }).data);
    second.onmessage = (event) => heard[1].push((event as { data: unknown }).data);
    await settle();
    expect(sources).toHaveLength(1);
    sources[0].onmessage?.({ data: 'x' });
    expect(heard).toEqual([['x'], ['x']]);
  });

  it('opens a stream in the waiting page when the holder closes', async () => {
    const { sources } = fakeBrowser();
    const first = openSharedEventSource();
    const second = openSharedEventSource();
    const heard: unknown[] = [];
    second.onmessage = (event) => heard.push((event as { data: unknown }).data);
    await settle();
    first.close();
    await settle();
    expect(sources).toHaveLength(2);
    expect(sources[0].closed).toBe(true);
    sources[1].onmessage?.({ data: 'y' });
    expect(heard).toEqual(['y']);
  });

  it('opens nothing for a page that closed before it was granted the stream', async () => {
    const { sources } = fakeBrowser();
    const first = openSharedEventSource();
    const second = openSharedEventSource();
    await settle();
    second.close();
    first.close();
    await settle();
    expect(sources).toHaveLength(1);
  });

  it('opens a stream of its own without Web Locks', () => {
    const { sources } = fakeBrowser();
    vi.stubGlobal('navigator', {});
    openSharedEventSource();
    expect(sources).toHaveLength(1);
  });

  it('refetches a follower on a relayed welcome and on the welcome of the stream it takes over', async () => {
    const { sources } = fakeBrowser();
    let clock = 0;
    let refetches = 0;
    let leaderRefetches = 0;
    const stopLeader = listenForEvents({ refetch: () => (leaderRefetches += 1), now: () => clock });
    await settle();
    sources[0].onmessage?.({ data: '{"type":"welcome"}' });
    expect(leaderRefetches).toBe(0);
    // The follower opens later and never hears the welcome of the leader's connection.
    clock = 30_000;
    listenForEvents({ refetch: () => (refetches += 1), now: () => clock });
    await settle();
    expect(sources).toHaveLength(1);
    clock = 60_000;
    sources[0].onmessage?.({ data: '{"type":"welcome"}' });
    expect(refetches).toBe(1);
    stopLeader();
    await settle();
    expect(sources).toHaveLength(2);
    clock = 120_000;
    sources[1].onmessage?.({ data: '{"type":"welcome"}' });
    expect(refetches).toBe(2);
  });
});
