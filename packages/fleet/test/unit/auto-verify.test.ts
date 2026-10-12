// The verify pass: a Delivered plan with no current record is judged when the
// switch, the command and the machine allow it, one run at a time, and every
// refusal is named.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FleetReading } from '@plot-pm/domain';
import { removeTree as rmTree } from '../rm-tree.mjs';
import {
  readVerifyCandidatesWith,
  readVerifyState,
  readVerifyStatus,
  runAutoVerifyPass,
  verifyPrompt,
  verifyRunDir,
  verifyStatePath,
  verifyStatusLines,
  verifyingCount,
  type VerifyCandidate,
  type VerifyCandidatePorts,
  type VerifyPassWorld,
  type VerifyStateFile,
} from '../../src/shared/auto-verify.js';
import { boardRunsSettled } from '../../src/shared/board-run.js';

const made: string[] = [];
afterEach(async () => {
  await boardRunsSettled();
  while (made.length) rmTree(made.pop()!);
});

const pulse = { plans: [] } as unknown as FleetReading;
const readings = { headroom: 'clear' as const, machineOverride: false, held: [] };
const candidate: VerifyCandidate = { slug: 'alpha', tracer: false, deliveryCommit: 'abc1234', verified: false };

const world = (
  candidates: VerifyCandidate[],
  options: { alive?: (pid: number) => boolean; unread?: Record<string, string>; removed?: string[] } = {},
): VerifyPassWorld => ({
  candidates: async () => ({
    plans: new Map(candidates.map((c) => [c.slug, c])),
    unread: new Map(Object.entries(options.unread ?? {})),
  }),
  alive: options.alive ?? ((pid: number) => pid === process.pid),
  removeTrees: async (_opts, slug) => {
    options.removed?.push(slug);
  },
});

const configScript = (autoVerify: string, command: string, bound = ''): string =>
  `#!/usr/bin/env bash\ncase "$2" in\n"Auto-verify") echo ${autoVerify};;\n"Worker bound") printf '%s\\n' "${bound}" ;;\n"Verify command") cat <<'EOF_CMD'\n${command}\nEOF_CMD\n;;\n*) printf '%s\\n' "\${3:-}";;\nesac\n`;

const fixture = (autoVerify: string, command: string, bound = '') => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autover-'));
  const repoRoot = path.join(parent, 'repo');
  fs.mkdirSync(repoRoot);
  const scriptsDir = path.join(parent, 'scripts');
  fs.mkdirSync(scriptsDir);
  made.push(parent);
  fs.writeFileSync(path.join(scriptsDir, 'plot-config.sh'), configScript(autoVerify, command, bound), { mode: 0o755 });
  return { repoRoot, scriptsDir, marker: path.join(parent, 'ran.txt') };
};

const seed = (repoRoot: string, state: Partial<VerifyStateFile>): void => {
  fs.mkdirSync(path.dirname(verifyStatePath(repoRoot)), { recursive: true });
  fs.writeFileSync(
    verifyStatePath(repoRoot),
    JSON.stringify({ failures: {}, failedAt: [], lastSuccessAt: 0, running: {}, refusals: {}, rows: [], last: {}, ...state }),
  );
};

/** A tree a person's `/plot-deliver --verify` holds: a run directory the fleet did not start. */
const handTree = (repoRoot: string, slug: string): string => {
  const pin = path.join(verifyRunDir(repoRoot, slug), 'pin');
  fs.mkdirSync(pin, { recursive: true });
  fs.writeFileSync(path.join(pin, '.plot-verify.pid'), '4242\n');
  return pin;
};

describe('verifyPrompt', () => {
  it('runs prepare, then names the tools tree\'s skill files by absolute path', () => {
    const prompt = verifyPrompt('alpha', '/r', '/s');
    expect(prompt).toContain('node /s/board/plot-verify.mjs prepare alpha');
    expect(prompt).toContain('/r/.plot/state/verify/alpha/tools/skills/plot-deliver/SKILL.md, section "Verify mode"');
    expect(prompt).toContain('/r/.plot/state/verify/alpha/tools/skills/plot-panel/SKILL.md');
    expect(prompt).toContain('Do not use an installed /plot-deliver or /plot-panel skill');
    expect(prompt.indexOf('prepare alpha')).toBeLessThan(prompt.indexOf('plot-deliver/SKILL.md'));
  });
});

describe('runAutoVerifyPass', () => {
  it('starts nothing, settles nothing and removes no tree while Auto-verify is not true', async () => {
    const f = fixture('false', 'true');
    const pin = handTree(f.repoRoot, 'alpha');
    seed(f.repoRoot, { running: { beta: { pid: 99999999, commit: 'c', startedAt: 1 } } });
    const removed: string[] = [];
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate], { alive: () => false, removed }));
    expect(started).toEqual([]);
    const state = readVerifyState(f.repoRoot)!;
    expect(state.refusals).toEqual({ alpha: 'off' });
    expect(Object.keys(state.running)).toEqual(['beta']);
    expect(removed).toEqual([]);
    expect(fs.existsSync(pin)).toBe(true);
  });

  it('starts one run with the prompt that runs the tools tree\'s skill text', async () => {
    const f = fixture('true', '');
    const command = `sh -c 'printf "%s\\n" "$1" >> ${f.marker}' sh`;
    fs.writeFileSync(path.join(f.scriptsDir, 'plot-config.sh'), configScript('true', command), { mode: 0o755 });
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate]));
    expect(started).toEqual(['alpha']);
    await boardRunsSettled();
    expect(fs.readFileSync(f.marker, 'utf8').trim()).toBe(verifyPrompt('alpha', f.repoRoot, f.scriptsDir));
  });

  it('starts at most one run per pass, and names running for the rest', async () => {
    const f = fixture('true', 'true');
    const plans = ['alpha', 'beta', 'gamma'].map((slug) => ({ ...candidate, slug }));
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world(plans));
    expect(started).toEqual(['alpha']);
    expect(readVerifyState(f.repoRoot)?.refusals).toEqual({ beta: 'running', gamma: 'running' });
  });

  it('starts no run while a run of another plan is going', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { beta: { pid: process.pid, commit: 'c', startedAt: 1 } } });
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate]));
    expect(started).toEqual([]);
    expect(readVerifyState(f.repoRoot)?.refusals).toEqual({ alpha: 'running' });
  });

  it('names queue-unread while no queue tick has been read', async () => {
    const f = fixture('true', 'true');
    const started = await runAutoVerifyPass(f, pulse, { ...readings, held: null }, 1000, world([candidate]));
    expect(started).toEqual([]);
    expect(readVerifyState(f.repoRoot)?.refusals).toEqual({ alpha: 'queue-unread' });
  });

  it('skips a plan that already holds a current record', async () => {
    const f = fixture('true', 'true');
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([{ ...candidate, verified: true }]));
    expect(started).toEqual([]);
  });

  it('halts the fleet after three failed runs across plans', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { failedAt: [1, 2, 3] });
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate]));
    expect(started).toEqual([]);
    expect(readVerifyState(f.repoRoot)?.refusals).toEqual({ alpha: 'halted' });
  });

  it("refuses a plan whose trees a person's run holds, and leaves those trees", async () => {
    const f = fixture('true', 'true');
    const pin = handTree(f.repoRoot, 'alpha');
    const removed: string[] = [];
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate], { removed }));
    expect(started).toEqual([]);
    expect(readVerifyState(f.repoRoot)?.refusals).toEqual({ alpha: 'hand-run' });
    expect(removed).toEqual([]);
    expect(fs.existsSync(pin)).toBe(true);
  });

  it('counts an ended run with no record as a failure, removes its trees and writes its row', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1, code: 1, endedAt: 5 } } });
    const removed: string[] = [];
    await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate], { alive: () => false, removed }));
    const state = readVerifyState(f.repoRoot)!;
    expect(state.failures.alpha?.count).toBe(1);
    expect(state.failedAt).toEqual([1000]);
    expect(state.running).toEqual({});
    expect(state.last.alpha).toEqual({ startedAt: 1, endedAt: 5, settlement: { settle: 'failure', why: 'the run exited 1' } });
    expect(removed).toEqual(['alpha']);
    expect(state.rows).toEqual([
      expect.objectContaining({ slug: 'alpha', restart: '/plot-deliver --verify alpha', reason: 'verification failed 1 time' }),
    ]);
  });

  it('counts an ended run as a success when the default branch holds its record, and lifts the halt', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, {
      failures: { alpha: { count: 2, lastAt: 3, reading: 'abc1234' } },
      failedAt: [1, 2, 3],
      running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1, code: 0 } },
    });
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([{ ...candidate, verified: true }], { alive: () => false }));
    expect(started).toEqual([]);
    const state = readVerifyState(f.repoRoot)!;
    expect(state.failures).toEqual({});
    expect(state.failedAt).toEqual([]);
    expect(state.lastSuccessAt).toBe(1000);
    expect(readVerifyStatus(f.repoRoot)?.halted).toBe(false);
  });

  it('counts neither success nor failure for a run whose plan left Delivered', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1, code: 0 } } });
    await runAutoVerifyPass(f, pulse, readings, 1000, world([], { alive: () => false }));
    const state = readVerifyState(f.repoRoot)!;
    expect(state.failures).toEqual({});
    expect(state.failedAt).toEqual([]);
    expect(state.lastSuccessAt).toBe(0);
    expect(state.running).toEqual({});
  });

  it('keeps a run whose plan cannot be read, to settle it on a later pass', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1, code: 0 } } });
    await runAutoVerifyPass(f, pulse, readings, 1000, world([], { alive: () => false, unread: { alpha: 'x' } }));
    expect(Object.keys(readVerifyState(f.repoRoot)!.running)).toEqual(['alpha']);
  });

  it("counts a person's record as a success that clears the plan's failures and the halt", async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { failures: { alpha: { count: 3, lastAt: 3, reading: 'abc1234' } }, failedAt: [1, 2, 3] });
    await runAutoVerifyPass(f, pulse, readings, 1000, world([{ ...candidate, verified: true }]));
    const state = readVerifyState(f.repoRoot)!;
    expect(state.failures).toEqual({});
    expect(state.lastSuccessAt).toBe(1000);
    expect(state.rows).toEqual([]);
  });

  it('passes Worker bound to the run, and a run ended on it counts as a failure', async () => {
    // The comment drops the prompt the runner appends as the fragment's argument.
    const f = fixture('true', 'sleep 30 #', '1');
    const started = await runAutoVerifyPass(f, pulse, readings, 1000, world([candidate]));
    expect(started).toEqual(['alpha']);
    await boardRunsSettled();
    expect(readVerifyState(f.repoRoot)!.running.alpha?.code).toBe(124);
    await runAutoVerifyPass(f, pulse, readings, 2000, world([candidate], { alive: () => false }));
    const state = readVerifyState(f.repoRoot)!;
    expect(state.failures.alpha?.count).toBe(1);
    expect(state.last.alpha?.settlement).toEqual({ settle: 'failure', why: 'the run reached Worker bound' });
  }, 20_000);
});

describe('verifyingCount', () => {
  it('counts a run whose agent pid is not recorded yet, and not an ended one', () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, {
      running: {
        starting: { pid: 0, commit: 'c', startedAt: 1000 },
        live: { pid: 7, commit: 'c', startedAt: 1 },
        ended: { pid: 7, commit: 'c', startedAt: 1, code: 0 },
      },
    });
    expect(verifyingCount(f.repoRoot, (pid) => pid === 7, 2000)).toBe(2);
    expect(verifyingCount(f.repoRoot, (pid) => pid === 7, 1000 + 6 * 60 * 1000)).toBe(1);
  });
});

describe('readVerifyCandidatesWith', () => {
  const planText = (state: string, verified = '') =>
    `# P\n\n## Status\n\n- **State:** ${state}\n- **Delivered:** 2026-10-05, T\n${verified ? `- **Verified:** ${verified}\n` : ''}`;
  const pulseOf = (files: Record<string, string>) =>
    ({ plans: Object.entries(files).map(([file, phase]) => ({ file, phase, tracer: false })) }) as unknown as FleetReading;
  const ports = (texts: Record<string, string>, asked: string[] = []): VerifyCandidatePorts => ({
    refs: {
      defaultBranch: async () => ({ ok: true, value: 'main' }),
      showFile: async (ref, file) => {
        asked.push(`${ref}:${file}`);
        return file in texts ? { ok: true, value: texts[file]! } : { ok: false, why: 'missing' };
      },
      recordCommit: async () => ({ ok: true, value: 'abc1234' }),
    } as VerifyCandidatePorts['refs'],
    scripts: {
      planMeta: async (files) => ({
        ok: true,
        value: files
          .map((file) => {
            const text = fs.readFileSync(file, 'utf8');
            const state = /State:\*\* (\w+)/.exec(text)?.[1]?.toLowerCase() ?? '';
            const verified = /Verified:\*\* (.*)/.exec(text)?.[1] ?? '';
            return JSON.stringify({ file, phase: state, delivered_raw: '2026-10-05, T', verified_raw: verified });
          })
          .join('\n'),
      }),
    } as VerifyCandidatePorts['scripts'],
  });

  it('reads each plan at origin/<main>, leaves out one that is no longer Delivered, and names an unread one', async () => {
    const asked: string[] = [];
    const answer = await readVerifyCandidatesWith(
      ports(
        {
          'docs/plans/2026-10-01-alpha.md': planText('Delivered'),
          'docs/plans/2026-10-01-beta.md': planText('Released'),
        },
        asked,
      ),
      pulseOf({
        'docs/plans/2026-10-01-alpha.md': 'delivered',
        'docs/plans/2026-10-01-beta.md': 'released',
        'docs/plans/2026-10-01-gamma.md': 'delivered',
      }),
      new Set(['beta']),
    );
    expect(asked.every((a) => a.startsWith('origin/main:'))).toBe(true);
    expect([...answer.plans.keys()]).toEqual(['alpha']);
    expect(answer.plans.get('alpha')).toEqual({ slug: 'alpha', tracer: false, deliveryCommit: 'abc1234', verified: false });
    expect(answer.unread.get('gamma')).toBe('the plan cannot be read at origin/main');
  });

  it('asks nothing about a plan that is neither Delivered in the pulse nor wanted', async () => {
    const asked: string[] = [];
    const answer = await readVerifyCandidatesWith(ports({}, asked), pulseOf({ 'docs/plans/x.md': 'approved' }), new Set());
    expect(asked).toEqual([]);
    expect(answer.plans.size).toBe(0);
  });
});

describe('verifyStatusLines', () => {
  it('names the halt, the running plans, each refusal and each row', () => {
    const text = verifyStatusLines({
      halted: true,
      running: ['alpha'],
      refusals: { beta: 'starved' },
      rows: [{ slug: 'gamma', reason: 'verification failed 1 time', log: '/l', restart: '/plot-deliver --verify gamma', stopped: false, fleetHalted: true }],
      last: {},
    });
    expect(text).toBe(
      'verification: halted, 1 running, 1 refused\n' +
        '  alpha  running\n' +
        '  beta  refused: starved\n' +
        '  gamma  waiting on you: verification failed 1 time — /plot-deliver --verify gamma (log /l)\n',
    );
  });

  it('prints nothing where nothing was recorded, and names an unreadable state', () => {
    expect(verifyStatusLines({ halted: false, running: [], refusals: {}, rows: [], last: {} })).toBe('');
    expect(verifyStatusLines(null)).toBe('verification: the state file cannot be read\n');
  });
});
