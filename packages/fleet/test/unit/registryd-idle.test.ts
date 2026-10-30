import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeRunLogLine } from '@plot-pm/domain/adapters';
import type { Notifier } from '@plot-pm/domain/ports/notifier';
import { idleEpisodeKey } from '@plot-pm/domain/rules/slice-idle';

import { notifyIdleSlices, idleWorldForRepo } from '../../src/server/entry/registryd-main.js';
import type { TickReport } from '../../src/server/entry/registryd.js';

/**
 * `notifyIdleSlices` and `idleWorldForRepo` — wave 2's applier and reader,
 * mirroring `notifyEscalations — applies the tick's notify writes, once
 * each` in `registryd-main.test.ts`.
 */

const RUN_LOG_HOME_ENV = 'PLOT_RUN_LOG_HOME';

const dirs: string[] = [];
const repo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-idle-notify-'));
  dirs.push(dir);
  return dir;
};

const readRunLog = (root: string) => {
  const raw = (() => {
    try {
      return readFileSync(join(root, 'run-log.tsv'), 'utf8');
    } catch {
      return '';
    }
  })();
  return raw
    .split('\n')
    .filter((l: string) => l !== '')
    .map((l: string) => decodeRunLogLine(l))
    .filter((l): l is NonNullable<typeof l> => l !== null);
};

const idleTick = (branch: string, clockStart: string, message = 'idle'): TickReport => ({
  startedAt: 0,
  costMs: 1,
  agents: 1,
  incomplete: '',
  handOver: null,
  decision: {
    outcome: 'decided',
    workflow: 'supervise',
    writes: [{ kind: 'idle-notify', branch, clockStart, message }],
    detail: {
      agents: [],
      left: [],
      reaping: [],
      correcting: [],
      needingAPerson: [],
      deferred: [],
      unclaimed: [],
    },
  },
});

describe('notifyIdleSlices — applies the tick\'s idle-notify writes, once each', () => {
  it('records sent on a successful send, with `at` the episode\'s clock start — not the send time', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    const sent: string[] = [];
    const notifier: Notifier = { notify: async (m) => { sent.push(m); return { ok: true }; } };
    const clockStart = '2026-10-01T00:00:00.000Z';
    await notifyIdleSlices(idleTick('feature/x', clockStart), root, async () => notifier, async () => 'plan-a', () => {}, () => {});
    expect(sent).toEqual(['idle']);
    const lines = readRunLog(root);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ branch: 'feature/x', step: 'notified', outcome: 'sent', at: clockStart });
    delete process.env[RUN_LOG_HOME_ENV];
  });

  it('records unaskable without sending, when no Notify command is configured', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    const notifier: Notifier = { notify: async () => ({ ok: false, why: 'unaskable' }) };
    await notifyIdleSlices(idleTick('feature/x', '2026-10-01T00:00:00.000Z'), root, async () => notifier, async () => 'plan-a', () => {}, () => {});
    expect(readRunLog(root)[0]).toMatchObject({ outcome: 'unaskable' });
    delete process.env[RUN_LOG_HOME_ENV];
  });

  it('records failed with the exit code on a broken command', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    const notifier: Notifier = { notify: async () => ({ ok: false, why: 'failed', code: 7 }) };
    await notifyIdleSlices(idleTick('feature/x', '2026-10-01T00:00:00.000Z'), root, async () => notifier, async () => 'plan-a', () => {}, () => {});
    expect(readRunLog(root)[0]).toMatchObject({ outcome: 'failed 7' });
    delete process.env[RUN_LOG_HOME_ENV];
  });

  it('a notifier that throws does not end the tick — the caller\'s try/catch, not this function\'s', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    const notifier: Notifier = { notify: async () => { throw new Error('boom'); } };
    await expect(
      notifyIdleSlices(idleTick('feature/x', '2026-10-01T00:00:00.000Z'), root, async () => notifier, async () => 'plan-a', () => {}, () => {}),
    ).rejects.toThrow('boom');
    delete process.env[RUN_LOG_HOME_ENV];
  });

  it('a second tick for the same episode does not re-notify, once the caller reads the recorded line back', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    const notifier: Notifier = { notify: async () => ({ ok: true }) };
    const clockStart = '2026-10-01T00:00:00.000Z';
    await notifyIdleSlices(idleTick('feature/x', clockStart), root, async () => notifier, async () => 'plan-a', () => {}, () => {});
    const recorded = await idleWorldForRepo(root, '/nonexistent', Date.now(), async () => []).recordedEpisodes();
    expect(recorded.has(idleEpisodeKey('feature/x', clockStart))).toBe(true);
    delete process.env[RUN_LOG_HOME_ENV];
  });

  it('asks for the notifier only where the tick holds an idle-notify write', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    let asked = 0;
    const report = idleTick('feature/x', '2026-10-01T00:00:00.000Z');
    await notifyIdleSlices(
      { ...report, decision: { ...report.decision, writes: [] } },
      root,
      async () => { asked += 1; return { notify: async () => ({ ok: true }) }; },
      async () => 'plan-a',
      () => {},
      () => {},
    );
    expect(asked).toBe(0);
    delete process.env[RUN_LOG_HOME_ENV];
  });

  it('sends every idle-notify write concurrently, so the slowest send bounds the pass', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    let inFlight = 0;
    let peak = 0;
    const notifier: Notifier = {
      notify: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return { ok: true };
      },
    };
    const report = idleTick('feature/a', '2026-10-01T00:00:00.000Z');
    const writes = ['feature/a', 'feature/b', 'feature/c'].map((branch) => ({
      kind: 'idle-notify' as const,
      branch,
      clockStart: '2026-10-01T00:00:00.000Z',
      message: branch,
    }));
    await notifyIdleSlices(
      { ...report, decision: { ...report.decision, writes } },
      root,
      async () => notifier,
      async () => 'plan-a',
      () => {},
      () => {},
    );
    expect(peak).toBe(3);
    expect(readRunLog(root)).toHaveLength(3);
    delete process.env[RUN_LOG_HOME_ENV];
  });
});

describe('idleWorldForRepo', () => {
  it('reads an unparseable `createdAt` as absent, never throwing — the named createdAt gap', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    const reader = idleWorldForRepo(root, '/nonexistent', Date.parse('2026-10-01T00:00:00.000Z'), async () => [
      { worktree: root, branch: 'feature/x' },
    ], async () => ({ ok: true, value: 'not-merged' }));
    const readings = await reader.readings();
    expect(readings).toHaveLength(1);
    expect(readings[0].pr.createdAt).toBe('');
    delete process.env[RUN_LOG_HOME_ENV];
  });

  it('excludes a branch the host reports merged', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    const reader = idleWorldForRepo(root, '/nonexistent', Date.now(), async () => [
      { worktree: root, branch: 'feature/merged' },
    ], async () => ({ ok: true, value: 'merged' }));
    expect(await reader.readings()).toEqual([]);
    delete process.env[RUN_LOG_HOME_ENV];
  });

  it('reads recorded episodes from the `notified` lines already in the run log — no second ledger', async () => {
    const root = repo();
    process.env[RUN_LOG_HOME_ENV] = root;
    const clockStart = '2026-10-01T00:00:00.000Z';
    writeFileSync(
      join(root, 'run-log.tsv'),
      ['plan-a', 'feature/x', '', '', 'notified', 'sent', clockStart].join('\t') + '\n',
    );
    const reader = idleWorldForRepo(root, '/nonexistent', Date.now(), async () => []);
    const recorded = await reader.recordedEpisodes();
    expect(recorded.has(idleEpisodeKey('feature/x', clockStart))).toBe(true);
    delete process.env[RUN_LOG_HOME_ENV];
  });
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
