import { describe, expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);
const GATE = 'turn-gate';

const finding = (name: string, branch: string) => ({
  monitor: 'IndexMonitor',
  branch,
  worktree: '/w',
  finding: name,
  since: '2026-10-10T09:00:00Z',
  evidence: `evidence of ${branch}`,
  measuredAt: '2026-10-10T09:00:00Z',
});

const welcome = (current: ReturnType<typeof finding>[]) => ({ type: 'welcome', current, measurable: [] });
const message = (name: string, branch: string) => ({ type: 'finding', finding: finding(name, branch) });

/**
 * A fixture channel: the follower's stdout is a queue the test feeds, and the
 * hooks beneath the plugin record everything the mod asks of the engine.
 */
const fixture = (on: On, options: { exitCode?: number } = {}) => {
  const queue: (string | null)[] = [];
  let wake: (() => void) | undefined;
  const seen = { spawned: [] as string[][], turns: [] as string[], toasts: [] as string[], statuses: [] as (string | undefined)[], processRuns: 0 };

  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('process.spawn', async function* ($, e) {
    seen.spawned.push([...e.argv]);
    if (options.exitCode !== undefined) return { code: options.exitCode, signal: null };
    for (;;) {
      while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      const next = queue.shift();
      if (next === null) return { code: 0, signal: null };
      yield { stream: 'stdout' as const, text: `${JSON.stringify(next)}\n` };
    }
  });
  on('process.run', () => {
    seen.processRuns += 1;
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  on('prompt.submit', (_$, e) => {
    seen.turns.push(e.text);
    return { text: e.text };
  });
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text);
  });
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text);
  });
  on('ui.open', () => ({ value: { isPlaced: true } }) as never);

  return {
    seen,
    feed: (line: unknown) => {
      queue.push(line as never);
      wake?.();
    },
    close: () => {
      queue.push(null);
      wake?.();
    },
  };
};

const start = async ($: Engine) => {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false });
};

const LISTED = { options: { turnOn: 'checks failing' } };

describe('plot-follow', () => {
  test('a second listed finding at minute 4 starts no turn; at minute 6 the turn carries it', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'one'));
    await clock.settle();
    expect(channel.seen.turns).toHaveLength(1);

    await clock.advance(4 * MIN);
    channel.feed(message('checks failing', 'two'));
    await clock.settle();
    expect(channel.seen.turns).toHaveLength(1);

    await clock.advance(2 * MIN);
    channel.feed(message('checks failing', 'three'));
    await clock.settle();
    expect(channel.seen.turns).toHaveLength(2);
    expect(channel.seen.turns[1]).toContain('two');
    expect(channel.seen.turns[1]).toContain('three');
  });

  test('the 25th listed finding of a day starts no turn, across a reload', LISTED, async ($, on) => {
    // The store a previous module instance left behind: 24 turns today.
    const clock = mock.clock(on, { now: T0 });
    mock.store(on, { [GATE]: { lastStartedAt: T0 - 10 * MIN, day: '2026-10-10', count: 24, held: [] } });
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'late'));
    await clock.settle();

    expect(channel.seen.turns).toHaveLength(0);
  });

  test('the next UTC day resets the count and the turn carries the held line', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on, { [GATE]: { lastStartedAt: T0 - 10 * MIN, day: '2026-10-09', count: 24, held: ['checks failing — late: e'] } });
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'today'));
    await clock.settle();

    expect(channel.seen.turns).toHaveLength(1);
    expect(channel.seen.turns[0]).toContain('late');
    expect(channel.seen.turns[0]).toContain('today');
  });

  test('an unlisted finding shows a toast when it is one of three and starts no turn', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('pr merged', 'one'));
    channel.feed(message('owes an answer', 'two'));
    channel.feed(message('idle', 'three'));
    await clock.settle();

    expect(channel.seen.toasts).toEqual(['pr merged — one', 'owes an answer — two']);
    expect(channel.seen.turns).toHaveLength(0);
  });

  test('the default list is empty: a first install starts no turn', async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'one'));
    await clock.settle();

    expect(channel.seen.turns).toHaveLength(0);
  });

  test('with no channel running the module loads, says not running and starts nothing', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on, { exitCode: 2 });
    await start($);
    await clock.settle();

    expect(channel.seen.statuses.at(-1)).toBe('fleet channel: not running');
    expect(channel.seen.turns).toHaveLength(0);

    // The retry is a timer, not a failure of the session.
    await clock.advance(30_000);
    expect(channel.seen.spawned.length).toBeGreaterThan(1);
  });

  test('a clear removes the finding from the pane', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([finding('checks failing', 'one')]));
    await clock.settle();
    const pane = { plugin: 'plot-follow', surface: 'terminal', component: 'Pane', requestId: 'plot-follow', props: { bodyColumns: 80 } } as const;
    const before = await $.ui.mount(pane as never);
    expect(await before.find({ type: 'Text', text: /checks failing — one/ })).toBeDefined();
    await before.unmount();

    channel.feed({ type: 'finding', finding: finding('clear', 'one') });
    await clock.settle();
    const after = await $.ui.mount(pane as never);
    expect(await after.find({ type: 'Text', text: /checks failing — one/ })).toBeUndefined();
    expect(await after.find({ type: 'Text', text: /no current findings/ })).toBeDefined();
  });

  test('a pane built from no welcome says it has heard nothing', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    fixture(on);
    await start($);
    await clock.settle();
    const ui = await $.ui.mount({ plugin: 'plot-follow', surface: 'terminal', component: 'Pane', requestId: 'plot-follow', props: { bodyColumns: 80 } } as never);

    expect(await ui.find({ type: 'Text', text: /nothing heard yet/ })).toBeDefined();
  });

  test('the only spawn is the follower and no host command runs', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'one'));
    await clock.settle();

    expect(channel.seen.spawned).toHaveLength(1);
    expect(channel.seen.spawned[0][0]).toBe('node');
    expect(channel.seen.spawned[0][1]).toMatch(/bin\/follow\.mjs$/);
    expect(channel.seen.spawned[0][2]).toBe('/repo');
    expect(channel.seen.processRuns).toBe(0);
  });
});
