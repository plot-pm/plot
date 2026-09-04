import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { argsFrom, readRegistry, reportTick } from '../../src/server/entry/registryd-main.js';
import { TICK_INTERVAL_MS, type TickReport } from '../../src/server/entry/registryd.js';
import { readTick, worldFrom, type SupervisorWorld } from '../../src/server/supervisor.js';
import type { AgentEntry } from '../../src/server/registry.js';

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    session: 'a1b2c3',
    resumeId: 'a1b2c3',
    branch: 'feature/one',
    worktree: '/estate/one',
    command: 'plot-worker-loop.sh',
    pid: '4242',
    attempts: 0,
    startedAt: '2026-09-04T10:00:00Z',
    ...over,
  });

describe('the daemon’s arguments', () => {
  it('loops by default, unbounded, at the measured interval', () => {
    expect(argsFrom([])).toEqual({ once: false, max: 0, intervalMs: TICK_INTERVAL_MS });
  });

  it('takes --once', () => {
    expect(argsFrom(['--once'])?.once).toBe(true);
  });

  it('accepts --dry-run and changes nothing, because every run is one', () => {
    // The tick performs nothing, so refusing the flag would make an operator
    // think it changed something and omitting it would make them think it was
    // not considered.
    expect(argsFrom(['--dry-run'])).toEqual(argsFrom([]));
  });

  it('takes a bound', () => {
    expect(argsFrom(['--max', '3'])?.max).toBe(3);
  });

  it('refuses a bound that is not a whole number', () => {
    expect(argsFrom(['--max', 'lots'])).toBeNull();
    expect(argsFrom(['--max', '-1'])).toBeNull();
    expect(argsFrom(['--max', '1.5'])).toBeNull();
  });

  it('takes an interval in seconds', () => {
    expect(argsFrom(['--interval', '30'])?.intervalMs).toBe(30_000);
  });

  it('refuses an interval of zero, which would be a spin', () => {
    expect(argsFrom(['--interval', '0'])).toBeNull();
    expect(argsFrom(['--interval', 'soon'])).toBeNull();
  });

  it('refuses an argument it does not take rather than ignoring it', () => {
    expect(argsFrom(['--reap-everything'])).toBeNull();
  });
});

describe('reading the registry', () => {
  it('reads every manifest, in a stable order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-registry-'));
    try {
      writeFileSync(join(dir, 'b.json'), manifest({ branch: 'feature/b' }));
      writeFileSync(join(dir, 'a.json'), manifest({ branch: 'feature/a' }));
      const entries = await readRegistry(dir, () => {});
      expect(entries.map((e) => e.branch)).toEqual(['feature/a', 'feature/b']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a missing registry as no agents rather than as an error', async () => {
    // A repository that has dispatched nothing has no directory, and a
    // supervisor over no agents has nothing to do rather than being broken.
    expect(await readRegistry(join(tmpdir(), 'plot-no-such-registry'), () => {})).toEqual([]);
  });

  it('skips a manifest that does not parse, and says which', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-registry-'));
    const warned: string[] = [];
    try {
      writeFileSync(join(dir, 'good.json'), manifest({ branch: 'feature/good' }));
      writeFileSync(join(dir, 'broken.json'), 'not json');
      const entries = await readRegistry(dir, (s) => warned.push(s));
      // ONE BAD FILE MUST NOT STOP THE TICK. Every other agent is still picked
      // up, and the file is named rather than silently dropped.
      expect(entries.map((e) => e.branch)).toEqual(['feature/good']);
      expect(warned.join('')).toContain('broken.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores files that are not manifests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-registry-'));
    try {
      writeFileSync(join(dir, 'notes.md'), '# not a manifest');
      writeFileSync(join(dir, 'one.json'), manifest());
      expect(await readRegistry(dir, () => {})).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a world may hold a reading for one tick and no longer', () => {
  /**
   * THE MEASURED REASON THIS EXISTS. The first working daemon read the plan
   * estate once per agent and a tick over three agents cost 10.0-11.5 s;
   * `readPlans` walks 172 files. Read once per tick it is 3.5 s.
   *
   * A memo that outlived the tick would make the daemon hold state, which is the
   * one property this design does not have.
   */
  const worldWithMemo = () => {
    let walks = 0;
    let memo: number | null = null;
    const world: SupervisorWorld = {
      beginTick: () => {
        memo = null;
      },
      workerAlive: async () => false,
      merge: async () => 'merged',
      dirtyPath: async () => '',
      blockedMarker: async () => '',
      changesets: async () => [],
      workspacePackages: async () => ['plot'],
      planLine: async () => {
        if (memo === null) {
          walks += 1;
          memo = walks;
        }
        return null;
      },
      madeProgress: async () => true,
      headroom: async () => 'clear',
      deskFile: () => null,
      transcriptFound: () => false,
    };
    return { world, walks: () => walks };
  };

  const entries = [
    { branch: 'feature/a', worktree: '/estate/a', resumeId: '', attempts: 0 },
    { branch: 'feature/b', worktree: '/estate/b', resumeId: '', attempts: 0 },
    { branch: 'feature/c', worktree: '/estate/c', resumeId: '', attempts: 0 },
  ] as unknown as AgentEntry[];

  it('walks once for three agents in one tick', async () => {
    const { world, walks } = worldWithMemo();
    await readTick(entries, world);
    expect(walks()).toBe(1);
  });

  it('walks again on the next tick, so a change reaches it', async () => {
    const { world, walks } = worldWithMemo();
    await readTick(entries, world);
    await readTick(entries, world);
    expect(walks()).toBe(2);
  });

  it('works for a world that holds nothing and defines no beginTick', async () => {
    const built = worldFrom({
      repoRoot: '/estate',
      isAlive: async () => false,
      prMerged: async () => 'merged',
      dirtyPaths: async () => [],
      markers: async () => [],
      planLine: async () => null,
      workspacePackages: async () => [],
      madeProgress: async () => true,
      spawnCostMs: async () => 4,
      recordedPid: () => null,
    });
    await expect(readTick(entries, built)).resolves.toBeDefined();
  });

  it('calls beginTick before any reading is taken', async () => {
    const order: string[] = [];
    const world: SupervisorWorld = {
      beginTick: () => order.push('begin'),
      workerAlive: async () => {
        order.push('read');
        return false;
      },
      merge: async () => 'merged',
      dirtyPath: async () => '',
      blockedMarker: async () => '',
      changesets: async () => [],
      workspacePackages: async () => {
        order.push('read');
        return [];
      },
      planLine: async () => null,
      madeProgress: async () => true,
      headroom: async () => {
        order.push('read');
        return 'clear';
      },
      deskFile: () => null,
      transcriptFound: () => false,
    };
    await readTick(entries, world);
    expect(order[0]).toBe('begin');
  });
});

describe('where a tick’s report goes', () => {
  /** A completed tick, as `tick` builds one. */
  const completed = (): TickReport => ({
    startedAt: 0,
    costMs: 250,
    agents: 1,
    incomplete: '',
    decision: {
      outcome: 'decided',
      workflow: 'supervise',
      writes: [],
      detail: {
        agents: [],
        left: ['feature/one'],
        reaping: [],
        correcting: [],
        needingAPerson: [],
        deferred: [],
      },
    },
  });

  /** A tick that could not complete, as `tick` builds one. */
  const incomplete = (reason: string): TickReport => ({
    ...completed(),
    agents: 0,
    incomplete: reason,
    decision: {
      outcome: 'decided',
      workflow: 'supervise',
      writes: [],
      detail: {
        agents: [],
        left: [],
        reaping: [],
        correcting: [],
        needingAPerson: [],
        deferred: [],
      },
    },
  });

  it('sends a completed tick to stdout', () => {
    const out: string[] = [];
    const err: string[] = [];
    expect(reportTick(completed(), (s) => out.push(s), (s) => err.push(s))).toBe(0);
    expect(out.join('')).toContain('agents=1');
    expect(err).toEqual([]);
  });

  it('sends an incomplete tick to stderr, which both units log separately', () => {
    // A person watching the error stream alone sees exactly the ticks that
    // could not be taken — which is what they look at when the supervisor is
    // not supervising.
    const out: string[] = [];
    const err: string[] = [];
    reportTick(incomplete('spawn git ENOMEM'), (s) => out.push(s), (s) => err.push(s));
    expect(out).toEqual([]);
    expect(err.join('')).toContain('incomplete');
    expect(err.join('')).toContain('spawn git ENOMEM');
  });

  it('says a one-shot run failed, so an operator’s exit code is honest', () => {
    expect(reportTick(incomplete('spawn git ENOMEM'), () => {}, () => {})).toBe(1);
    expect(reportTick(completed(), () => {}, () => {})).toBe(0);
  });

  it('says the next tick re-reads, because that is the whole recovery', () => {
    // No journal, no lock file, no resume path: the line names what happens
    // next so a reader does not go looking for one.
    const err: string[] = [];
    reportTick(incomplete('scandir failed'), () => {}, (s) => err.push(s));
    expect(err.join('')).toContain('next=re-reads');
  });
});
