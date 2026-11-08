import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listenForEvents,
  openSharedEventSource,
  pageShown,
  pollWhileShown,
  type EventSourceLike,
  type PageLike,
} from '../../src/app/lib/event-listener.js';

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
  // A request whose signal aborts before its turn is never granted, as in a browser.
  const requests: { signal?: AbortSignal; granted: boolean; released: boolean }[] = [];
  const locks = {
    request: (name: string, options: { signal?: AbortSignal }, callback: () => unknown): Promise<unknown> => {
      const request = { signal: options.signal, granted: false, released: false };
      requests.push(request);
      const granted = (holders.get(name) ?? Promise.resolve()).then(() => {
        if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        request.granted = true;
        return Promise.resolve(callback()).finally(() => {
          request.released = true;
        });
      });
      holders.set(name, granted.then(() => undefined, () => undefined));
      return granted;
    },
  };
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  vi.stubGlobal('navigator', { locks });
  return { sources, channels, requests };
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

/** A page whose visibility a test sets, with the listeners the page registered. */
const fakePage = (state: DocumentVisibilityState = 'visible') => {
  const listeners = new Set<() => void>();
  const page: PageLike & { set: (next: DocumentVisibilityState) => void; listeners: Set<() => void> } = {
    visibilityState: state,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    set: (next) => {
      page.visibilityState = next;
      for (const listener of [...listeners]) listener();
    },
    listeners,
  };
  return page;
};

describe('pageShown', () => {
  it('answers true for a visible page and false for a hidden one', () => {
    expect(pageShown('visible')).toBe(true);
    expect(pageShown('hidden')).toBe(false);
  });

  it('answers true where no visibility is known', () => {
    expect(pageShown(undefined)).toBe(true);
  });
});

describe('listenForEvents on a page that hides', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('closes the stream when the page hides and opens a new one when it shows', () => {
    const page = fakePage();
    const opened: ReturnType<typeof fakeSource>[] = [];
    listenForEvents({ page, open: () => opened[opened.push(fakeSource()) - 1], refetch: () => undefined });
    expect(opened).toHaveLength(1);
    page.set('hidden');
    expect(opened[0].closed).toBe(true);
    page.set('visible');
    expect(opened).toHaveLength(2);
    expect(opened[1].closed).toBe(false);
  });

  it('refetches once when the page shows again, and not again for the new stream\'s welcome', () => {
    const page = fakePage();
    const opened: ReturnType<typeof fakeSource>[] = [];
    let refetches = 0;
    listenForEvents({ page, open: () => opened[opened.push(fakeSource()) - 1], refetch: () => (refetches += 1) });
    page.set('hidden');
    vi.advanceTimersByTime(60_000);
    page.set('visible');
    expect(refetches).toBe(1);
    opened[1].onmessage?.({ data: '{"type":"welcome"}' });
    vi.advanceTimersByTime(10_000);
    expect(refetches).toBe(1);
  });

  it('opens no stream for a page that starts hidden, until it shows', () => {
    const page = fakePage('hidden');
    let opens = 0;
    let refetches = 0;
    listenForEvents({ page, open: () => ((opens += 1), fakeSource()), refetch: () => (refetches += 1) });
    expect(opens).toBe(0);
    page.set('visible');
    expect(opens).toBe(1);
    expect(refetches).toBe(1);
  });

  it('sends no trailing refetch after the page hides', () => {
    const page = fakePage();
    const source = fakeSource();
    let refetches = 0;
    listenForEvents({ page, open: () => source, refetch: () => (refetches += 1) });
    source.onmessage?.({});
    source.onmessage?.({});
    page.set('hidden');
    vi.advanceTimersByTime(5_000);
    expect(refetches).toBe(1);
  });

  it('removes its visibility listener when stopped', () => {
    const page = fakePage();
    const stop = listenForEvents({ page, open: fakeSource, refetch: () => undefined });
    stop();
    expect(page.listeners.size).toBe(0);
  });

  it('reads the global document when no page is given', () => {
    const page = fakePage('hidden');
    vi.stubGlobal('document', page);
    let opens = 0;
    listenForEvents({ open: () => ((opens += 1), fakeSource()), refetch: () => undefined });
    expect(opens).toBe(0);
    page.set('visible');
    expect(opens).toBe(1);
  });
});

describe('listenForEvents across tabs that hide', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('releases the lock and closes the relay when the holder hides, and re-requests it when it shows', async () => {
    const { sources, channels, requests } = fakeBrowser();
    const page = fakePage();
    let refetches = 0;
    listenForEvents({ page, refetch: () => (refetches += 1) });
    await settle();
    expect(sources).toHaveLength(1);
    expect(channels).toHaveLength(1);
    page.set('hidden');
    await settle();
    expect(sources[0].closed).toBe(true);
    expect(requests[0].released).toBe(true);
    expect(channels).toHaveLength(0);
    page.set('visible');
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests[1].granted).toBe(true);
    expect(sources).toHaveLength(2);
    expect(refetches).toBe(1);
  });

  it('aborts a pending lock request when a waiting tab hides, so the lock is never granted to it', async () => {
    const { sources, requests } = fakeBrowser();
    const holder = fakePage();
    const waiter = fakePage();
    listenForEvents({ page: holder, refetch: () => undefined });
    listenForEvents({ page: waiter, refetch: () => undefined });
    await settle();
    waiter.set('hidden');
    expect(requests[1].signal?.aborted).toBe(true);
    holder.set('hidden');
    await settle();
    expect(requests[1].granted).toBe(false);
    expect(sources).toHaveLength(1);
    expect(sources[0].closed).toBe(true);
  });

  it('hands the stream to the next visible tab when the holder hides', async () => {
    const { sources } = fakeBrowser();
    const holder = fakePage();
    const follower = fakePage();
    let heard = 0;
    listenForEvents({ page: holder, refetch: () => undefined });
    listenForEvents({ page: follower, refetch: () => (heard += 1) });
    await settle();
    holder.set('hidden');
    await settle();
    expect(sources).toHaveLength(2);
    expect(sources[0].closed).toBe(true);
    expect(sources[1].closed).toBe(false);
    sources[1].onmessage?.({ data: '{}' });
    expect(heard).toBe(1);
  });

  it('holds no stream when every tab is hidden', async () => {
    const { sources } = fakeBrowser();
    const pages = [fakePage(), fakePage(), fakePage()];
    for (const page of pages) listenForEvents({ page, refetch: () => undefined });
    await settle();
    for (const page of pages) page.set('hidden');
    await settle();
    expect(sources.every((source) => source.closed)).toBe(true);
  });

  it('closes and reopens a stream of its own without Web Locks or BroadcastChannel', () => {
    const { sources } = fakeBrowser();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('BroadcastChannel', undefined);
    const first = fakePage();
    const second = fakePage();
    listenForEvents({ page: first, refetch: () => undefined });
    listenForEvents({ page: second, refetch: () => undefined });
    expect(sources).toHaveLength(2);
    first.set('hidden');
    expect(sources[0].closed).toBe(true);
    expect(sources[1].closed).toBe(false);
    second.set('hidden');
    expect(sources[1].closed).toBe(true);
    first.set('visible');
    expect(sources).toHaveLength(3);
    expect(sources[2].closed).toBe(false);
  });
});

describe('pollWhileShown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls on its interval while the page is visible', () => {
    const page = fakePage();
    let polls = 0;
    pollWhileShown(page, () => (polls += 1), 30_000);
    vi.advanceTimersByTime(90_000);
    expect(polls).toBe(3);
  });

  it('clears the interval while the page is hidden and restores it when the page shows', () => {
    const page = fakePage();
    let polls = 0;
    pollWhileShown(page, () => (polls += 1), 4_000);
    vi.advanceTimersByTime(4_000);
    page.set('hidden');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(polls).toBe(1);
    page.set('visible');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(4_000);
    expect(polls).toBe(2);
  });

  it('polls nothing on show: the page\'s own visibility handler reloads', () => {
    const page = fakePage('hidden');
    let polls = 0;
    pollWhileShown(page, () => (polls += 1), 4_000);
    page.set('visible');
    expect(polls).toBe(0);
  });

  it('clears the interval and its listener when stopped', () => {
    const page = fakePage();
    const stop = pollWhileShown(page, () => undefined, 4_000);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(page.listeners.size).toBe(0);
  });

  it('runs two polls side by side and clears both on hide', () => {
    const page = fakePage();
    pollWhileShown(page, () => undefined, 30_000);
    pollWhileShown(page, () => undefined, 4_000);
    expect(vi.getTimerCount()).toBe(2);
    page.set('hidden');
    expect(vi.getTimerCount()).toBe(0);
    page.set('visible');
    expect(vi.getTimerCount()).toBe(2);
  });
});
