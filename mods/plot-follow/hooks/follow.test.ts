import { describe, expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);
const GATE = 'turn-gate:/repo';

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
  const queue: ({ json: unknown } | { raw: string } | null)[] = [];
  let wake: (() => void) | undefined;
  const seen = { spawned: [] as string[][], turns: [] as string[], toasts: [] as string[], statuses: [] as (string | undefined)[], processRuns: 0, closed: 0 };

  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('process.spawn', async function* ($, e) {
    seen.spawned.push([...e.argv]);
    if (options.exitCode !== undefined) return { code: options.exitCode, signal: null };
    try {
      for (;;) {
        while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const next = queue.shift();
        if (next === null || next === undefined) return { code: 0, signal: null };
        yield { stream: 'stdout' as const, text: 'raw' in next ? next.raw : `${JSON.stringify(next.json)}\n` };
      }
    } finally {
      // Runs when the reader closes the iterator early; the process is gone.
      seen.closed += 1;
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
    // A JSON message, framed as the follower writes it.
    feed: (line: unknown) => {
      queue.push({ json: line });
      wake?.();
    },
    // Bytes as they are, so a test can send what is not JSON.
    feedRaw: (text: string) => {
      queue.push({ raw: text });
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
    mock.store(on, { [GATE]: { lastStartedAt: T0 - 10 * MIN, day: '2026-10-09', count: 24, held: [{ slot: 'IndexMonitor\u0000late', line: 'checks failing — late: e' }] } });
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
  test('a clear retracts the line the gate was holding for the next turn', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on, { [GATE]: { lastStartedAt: T0 - MIN, day: '2026-10-10', count: 1, held: [] } });
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'one'));
    channel.feed(message('checks failing', 'two'));
    channel.feed({ type: 'finding', finding: finding('clear', 'one') });
    await clock.settle();
    expect(channel.seen.turns).toHaveLength(0);

    await clock.advance(6 * MIN);
    channel.feed(message('checks failing', 'three'));
    await clock.settle();

    expect(channel.seen.turns).toHaveLength(1);
    expect(channel.seen.turns[0]).not.toContain('one');
    expect(channel.seen.turns[0]).toContain('two');
    expect(channel.seen.turns[0]).toContain('three');
  });

  test('two findings arriving together both stay held, and another repository has its own gate', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    // Another repository's gate, and the single gate every repository shared before.
    mock.store(on, {
      'turn-gate:/elsewhere': { lastStartedAt: null, day: '', count: 0, held: [{ slot: 'x', line: 'other repo line' }] },
      'turn-gate': { lastStartedAt: null, day: '', count: 0, held: ['legacy shared line'] },
    });
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'one'));
    await clock.settle();
    channel.feed(message('checks failing', 'two'));
    channel.feed(message('checks failing', 'three'));
    await clock.settle();
    await clock.advance(6 * MIN);
    channel.feed(message('checks failing', 'four'));
    await clock.settle();

    expect(channel.seen.turns).toHaveLength(2);
    expect(channel.seen.turns[1]).toContain('two');
    expect(channel.seen.turns[1]).toContain('three');
    expect(channel.seen.turns.join('\n')).not.toContain('other repo line');
    expect(channel.seen.turns.join('\n')).not.toContain('legacy shared line');
  });

  test('a welcome that republishes a held finding starts no turn', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'one'));
    await clock.settle();
    expect(channel.seen.turns).toHaveLength(1);

    // fleetd restarts: the follower reconnects, and the channel says it all again.
    await clock.advance(6 * MIN);
    channel.feed(welcome([finding('checks failing', 'one')]));
    channel.feed(message('checks failing', 'one'));
    await clock.settle();

    expect(channel.seen.turns).toHaveLength(1);
  });

  test('a follower that writes what is not JSON is closed once and spawned once', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feedRaw('this is not json\n');
    await clock.settle();

    expect(channel.seen.closed).toBe(1);
    expect(channel.seen.statuses.at(-1)).toBe('fleet channel: not running');
    // The retry tick starts a new follower only when the old one is gone.
    await clock.advance(30_000);
    expect(channel.seen.spawned).toHaveLength(2);
  });
  test('a session.start that finds held findings marks them out of date until a welcome', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([finding('checks failing', 'one')]));
    await clock.settle();

    // A reload re-runs session.start; the atom keeps what the old module heard.
    // The test kit has no reload helper, so a second session.start stands in for one.
    await start($);
    await clock.settle();
    const pane = { plugin: 'plot-follow', surface: 'terminal', component: 'Pane', requestId: 'plot-follow', props: { bodyColumns: 80 } } as const;
    const stale = await $.ui.mount(pane as never);
    expect(await stale.find({ type: 'Text', text: /out of date/ })).toBeDefined();
    expect(await stale.find({ type: 'Text', text: /checks failing — one/ })).toBeDefined();
    await stale.unmount();

    channel.feed(welcome([finding('checks failing', 'one')]));
    await clock.settle();
    const fresh = await $.ui.mount(pane as never);
    expect(await fresh.find({ type: 'Text', text: /out of date/ })).toBeUndefined();
  });

  test('a fleetd restart that welcomes with nothing starts no second turn for the same finding', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'one'));
    await clock.settle();
    expect(channel.seen.turns).toHaveLength(1);

    // fleetd restarts empty: the follower ends, the retry respawns it, and the
    // channel welcomes with nothing before the monitor republishes the finding.
    channel.close();
    await clock.advance(6 * MIN);
    channel.feed(welcome([]));
    channel.feed(message('checks failing', 'one'));
    await clock.settle();

    expect(channel.seen.spawned.length).toBeGreaterThan(1);
    expect(channel.seen.turns).toHaveLength(1);
    expect(channel.seen.toasts).toEqual(['checks failing — one']);
  });

  test('a finding heard only in a welcome is an arrival: it toasts and starts a turn', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    await clock.settle();
    channel.close();

    // Published while no follower ran: the next welcome is the only place it shows.
    await clock.advance(MIN);
    channel.feed(welcome([finding('checks failing', 'missed'), finding('pr merged', 'landed')]));
    await clock.settle();

    expect(channel.seen.toasts).toEqual(['checks failing — missed', 'pr merged — landed']);
    expect(channel.seen.turns).toHaveLength(1);
    expect(channel.seen.turns[0]).toContain('missed');
  });

  test('a reading another session claimed toasts here and starts no turn here', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed({ ...welcome([finding('checks failing', 'one')]), claimed: [false] });
    channel.feed({ ...message('checks failing', 'two'), claimed: false });
    await clock.settle();

    expect(channel.seen.toasts).toEqual(['checks failing — one', 'checks failing — two']);
    expect(channel.seen.turns).toHaveLength(0);

    channel.feed({ ...message('checks failing', 'three'), claimed: true });
    await clock.settle();
    expect(channel.seen.turns).toHaveLength(1);
    expect(channel.seen.turns[0]).not.toContain('two');
  });

  test('one follower runs while it lives: retry ticks over 60 s spawn no second one', LISTED, async ($, on) => {
    const clock = mock.clock(on, { now: T0 });
    mock.store(on);
    const channel = fixture(on);
    await start($);
    channel.feed(welcome([]));
    await clock.settle();

    await clock.advance(60_000);
    await clock.settle();

    expect(channel.seen.spawned).toHaveLength(1);
  });
});
