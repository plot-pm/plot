import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FLEETD_HEARTBEAT_VERSION,
  decodeFleetdHeartbeat,
  encodeFleetdHeartbeat,
  type FleetdHeartbeat,
} from '../src/entities/fleetd-heartbeat.js';
import { bridgeVouched, fleetdReadsIssues, fleetdReadsPrs, lateLoopNote, fleetdLiveness, lateLoops, observerFresh } from '../src/rules/fleetd-live.js';
import { fleetdHeartbeatFile, fleetdHeartbeatPath, readFleetdHeartbeatSync } from '../src/adapters/fleetd-heartbeat/fleetd-heartbeat-file.js';

const T0 = 1_700_000_000_000;

const heartbeat = (overrides: Partial<FleetdHeartbeat> = {}): FleetdHeartbeat => ({
  version: FLEETD_HEARTBEAT_VERSION,
  pid: 4242,
  startedAt: T0 - 600_000,
  beatAt: T0,
  generation: 7,
  bridgeAt: null,
  supervised: 'none',
  watchesWanted: 0,
  watchesArmed: 0,
  lastEventAt: null,
  lastSafetyNetAt: null,
  loops: {},
  ...overrides,
});

describe('the heartbeat codec', () => {
  it('reads back what it wrote', () => {
    const beat = heartbeat({ protocol: 1, loops: { scan: { lastPassAt: T0 - 5_000 }, tick: { lastPassAt: null } } });
    expect(decodeFleetdHeartbeat(encodeFleetdHeartbeat(beat))).toEqual(beat);
  });

  it('writes one JSON line', () => {
    const text = encodeFleetdHeartbeat(heartbeat());
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n')).toHaveLength(2);
  });

  it('carries no protocol until the channel contract names one', () => {
    expect('protocol' in JSON.parse(encodeFleetdHeartbeat(heartbeat()))).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['blank', ' \n'],
    ['torn', '{"version":1,"pid":'],
    ['another version', JSON.stringify({ ...heartbeat(), version: 2 })],
    ['an unknown field', JSON.stringify({ ...heartbeat(), extra: true })],
    ['an unknown supervisor', JSON.stringify({ ...heartbeat(), supervised: 'runit' })],
  ])('reads a %s file as no heartbeat', (_name, text) => {
    expect(decodeFleetdHeartbeat(text)).toBeNull();
  });
});

describe('fleetdLiveness', () => {
  it.each([
    ['0 s', 0, 'live'],
    ['30 s', 30_000, 'live'],
    ['31 s', 31_000, 'stale'],
    ['a future beat', -1, 'stale'],
  ])('reads a heartbeat %s old as %s', (_name, age, expected) => {
    expect(fleetdLiveness(heartbeat({ beatAt: T0 - age }), T0)).toBe(expected);
  });

  it('reads no file as absent', () => {
    expect(fleetdLiveness(null, T0)).toBe('absent');
  });
});

describe('observerFresh', () => {
  it('holds while every loop passed inside its bound', () => {
    const beat = heartbeat({
      loops: {
        tick: { lastPassAt: T0 - 60_000 },
        scan: { lastPassAt: T0 - 180_000 },
        'pr-reader': { lastPassAt: T0 - 60_000 },
        'issue-reader': { lastPassAt: T0 - 120_000 },
      },
    });
    expect(observerFresh(beat, T0)).toBe(true);
    expect(lateLoops(beat, T0)).toEqual([]);
  });

  it('fails when the scan passed more than 180 s ago under a fresh beat', () => {
    const beat = heartbeat({ loops: { scan: { lastPassAt: T0 - 181_000 } } });
    expect(fleetdLiveness(beat, T0)).toBe('live');
    expect(observerFresh(beat, T0)).toBe(false);
    expect(lateLoops(beat, T0)).toEqual(['scan']);
  });

  it('names every late loop in a fixed order', () => {
    const beat = heartbeat({
      loops: {
        'issue-reader': { lastPassAt: T0 - 700_000 },
        tick: { lastPassAt: T0 - 400_000 },
        'pr-reader': { lastPassAt: T0 - 700_000 },
      },
    });
    expect(lateLoops(beat, T0)).toEqual(['tick', 'pr-reader', 'issue-reader']);
  });

  it('judges a loop with no pass yet from the process start', () => {
    const young = heartbeat({ startedAt: T0 - 100_000, loops: { scan: { lastPassAt: null } } });
    const old = heartbeat({ startedAt: T0 - 200_000, loops: { scan: { lastPassAt: null } } });
    expect(observerFresh(young, T0)).toBe(true);
    expect(observerFresh(old, T0)).toBe(false);
  });

  it('does not judge a loop the heartbeat does not report', () => {
    expect(observerFresh(heartbeat({ loops: {} }), T0)).toBe(true);
  });
});

describe('fleetdHeartbeatFile', () => {
  const sandbox = (): string => mkdtempSync(join(tmpdir(), 'plot-fleetd-heartbeat-'));

  it('writes under .plot/state/fleetd.json and reads it back', async () => {
    const dir = sandbox();
    try {
      const store = fleetdHeartbeatFile({ repoRoot: dir });
      const beat = heartbeat();
      expect((await store.write(beat)).ok).toBe(true);
      expect(fleetdHeartbeatPath(dir)).toBe(join(dir, '.plot', 'state', 'fleetd.json'));
      expect(JSON.parse(readFileSync(fleetdHeartbeatPath(dir), 'utf8'))).toEqual(beat);
      const read = await store.read();
      expect(read.ok && read.value).toEqual(beat);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no temp file after a write', async () => {
    const dir = sandbox();
    try {
      const store = fleetdHeartbeatFile({ repoRoot: dir });
      await store.write(heartbeat());
      await store.write(heartbeat({ beatAt: T0 + 10_000 }));
      expect(readdirSync(join(dir, '.plot', 'state'))).toEqual(['fleetd.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers null for a missing or unparseable file', async () => {
    const dir = sandbox();
    try {
      const store = fleetdHeartbeatFile({ repoRoot: dir });
      const missing = await store.read();
      expect(missing.ok && missing.value).toBeNull();
      mkdirSync(join(dir, '.plot', 'state'), { recursive: true });
      writeFileSync(fleetdHeartbeatPath(dir), '{ torn');
      const torn = await store.read();
      expect(torn.ok && torn.value).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails a read that is not a missing file, and a write that cannot land', async () => {
    const dir = sandbox();
    try {
      const store = fleetdHeartbeatFile({ repoRoot: dir });
      mkdirSync(fleetdHeartbeatPath(dir), { recursive: true });
      expect((await store.read()).ok).toBe(false);
      expect((await store.write(heartbeat())).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bridgeVouched', () => {
  it('vouches for the bridge the live heartbeat names', () => {
    expect(bridgeVouched({ at: T0 - 1_200_000 }, heartbeat({ bridgeAt: T0 - 1_200_000 }), T0)).toBe(true);
  });
  it('refuses a bridge the heartbeat does not name', () => {
    expect(bridgeVouched({ at: T0 - 1_200_000 }, heartbeat({ bridgeAt: T0 - 1_000 }), T0)).toBe(false);
    expect(bridgeVouched({ at: T0 - 1_200_000 }, heartbeat({ bridgeAt: null }), T0)).toBe(false);
  });
  it('refuses with a stale or absent heartbeat', () => {
    expect(bridgeVouched({ at: 5 }, heartbeat({ bridgeAt: 5, beatAt: T0 - 31_000 }), T0)).toBe(false);
    expect(bridgeVouched({ at: 5 }, null, T0)).toBe(false);
  });
});

describe('bridgeVouched with a late scan', () => {
  it('refuses while the scan loop is late and vouches once it is back', () => {
    const named = { bridgeAt: T0 - 1_200_000 };
    const late = heartbeat({ ...named, loops: { scan: { lastPassAt: T0 - 181_000 } } });
    expect(bridgeVouched({ at: T0 - 1_200_000 }, late, T0)).toBe(false);
    const onTime = heartbeat({ ...named, loops: { scan: { lastPassAt: T0 - 5_000 } } });
    expect(bridgeVouched({ at: T0 - 1_200_000 }, onTime, T0)).toBe(true);
  });
  it('is not refused by another loop being late', () => {
    const hb = heartbeat({ bridgeAt: 5, loops: { 'pr-reader': { lastPassAt: T0 - 700_000 } } });
    expect(bridgeVouched({ at: 5 }, hb, T0)).toBe(true);
  });
});

describe('fleetdReadsPrs', () => {
  it('needs a live heartbeat whose pr-reader loop is not late', () => {
    expect(fleetdReadsPrs(null, T0)).toBe(false);
    expect(fleetdReadsPrs(heartbeat({ beatAt: T0 - 31_000 }), T0)).toBe(false);
    expect(fleetdReadsPrs(heartbeat({ loops: { 'pr-reader': { lastPassAt: T0 - 700_000 } } }), T0)).toBe(false);
    expect(fleetdReadsPrs(heartbeat({ loops: { 'pr-reader': { lastPassAt: T0 - 5_000 }, scan: { lastPassAt: null } } }), T0)).toBe(true);
    expect(fleetdReadsPrs(heartbeat(), T0)).toBe(true);
  });
});

describe('readFleetdHeartbeatSync', () => {
  it('reads what the file adapter wrote and reads null where there is none', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-hb-sync-'));
    try {
      expect(readFleetdHeartbeatSync(root)).toBeNull();
      await fleetdHeartbeatFile({ repoRoot: root }).write(heartbeat());
      expect(readFleetdHeartbeatSync(root)).toEqual(heartbeat());
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});

describe('the heartbeat of a linked worktree', () => {
  it('is the main checkout heartbeat, whichever checkout reads or writes it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-hb-worktree-'));
    try {
      const main = join(root, 'main');
      const linked = join(root, 'linked');
      mkdirSync(main);
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd: main, stdio: 'ignore' });
      };
      git('init', '--quiet', '-b', 'main');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'seed');
      git('worktree', 'add', '--quiet', linked, '-b', 'side');
      await fleetdHeartbeatFile({ repoRoot: main }).write(heartbeat());
      expect(fleetdHeartbeatPath(linked)).toBe(fleetdHeartbeatPath(main));
      expect(readFleetdHeartbeatSync(linked)).toEqual(heartbeat());
      await fleetdHeartbeatFile({ repoRoot: linked }).write(heartbeat({ pid: 7 }));
      expect(readFleetdHeartbeatSync(main)?.pid).toBe(7);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('lateLoopNote', () => {
  it('names the late loops and is null for none', () => {
    expect(lateLoopNote([])).toBeNull();
    expect(lateLoopNote(['scan', 'tick'])).toBe(
      'the fleet is beating but its scan, tick loop has not completed a pass in time; the board scans in its place',
    );
  });
});

describe('fleetdReadsIssues', () => {
  it('needs a live heartbeat', () => {
    expect(fleetdReadsIssues(null, T0)).toBe(false);
    expect(fleetdReadsIssues(heartbeat({ beatAt: T0 - 31_000 }), T0)).toBe(false);
    expect(fleetdReadsIssues(heartbeat(), T0)).toBe(true);
  });

  it('is refused by a late issue-reader loop', () => {
    expect(fleetdReadsIssues(heartbeat({ loops: { 'issue-reader': { lastPassAt: T0 - 700_000 } } }), T0)).toBe(false);
    expect(fleetdReadsIssues(heartbeat({ startedAt: T0 - 700_000, loops: { 'issue-reader': { lastPassAt: null } } }), T0)).toBe(false);
  });

  it('is not refused by a late scan, tick or pr-reader loop', () => {
    const late = { lastPassAt: T0 - 700_000 };
    expect(fleetdReadsIssues(heartbeat({ loops: { 'issue-reader': { lastPassAt: T0 - 5_000 }, scan: late, tick: late, 'pr-reader': late } }), T0)).toBe(true);
  });

  it('does not judge an issue-reader loop absent from the heartbeat', () => {
    expect(fleetdReadsIssues(heartbeat({ loops: { scan: { lastPassAt: T0 - 700_000 } } }), T0)).toBe(true);
  });
});
