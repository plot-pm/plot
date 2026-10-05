import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shellContext } from '../src/adapters/scripts.js';
import { processesShell } from '../src/adapters/processes/processes-shell.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE NINTH RULE-VERSUS-SHELL COMPARISON: does `processesShell().activity`
 * answer what `plot_worker_activity` answers, for a subtree burning CPU, one
 * sleeping, and a pid that names nothing?
 *
 * THE PAIR EXISTS ON PURPOSE, for the reason `tree-reading.corpus.test.ts`
 * states. NEITHER SIDE IS AUTHORITATIVE — on a disagreement the branch stops,
 * and adjusting either side to make this pass is the one move forbidden.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const STATE_LIB = `${ROOT}/skills/plot/scripts/plot-worker-state.sh`;

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

const spawned: ChildProcess[] = [];
let busyParent = 0;
let sleeper = 0;
let busyChildOfSleepingParent = 0;

beforeAll(() => {
  // A parent whose CHILD burns the CPU: the subtree is what is sampled.
  const busy = spawn('bash', ['-c', 'yes > /dev/null & wait'], { stdio: 'ignore' });
  const quiet = spawn('sleep', ['120'], { stdio: 'ignore' });
  const nested = spawn('bash', ['-c', 'sleep 120 & wait'], { stdio: 'ignore' });
  spawned.push(busy, quiet, nested);
  busyParent = busy.pid ?? 0;
  sleeper = quiet.pid ?? 0;
  busyChildOfSleepingParent = nested.pid ?? 0;
});

afterAll(() => {
  for (const child of spawned) {
    // Only the pids this file spawned, and the burner their shell started.
    try {
      execFileSync('pkill', ['-P', String(child.pid)], { stdio: 'ignore' });
    } catch {
      // No children left.
    }
    child.kill('SIGKILL');
  }
});

const subjects = (): { name: string; pid: string }[] => [
  { name: 'busy-child', pid: String(busyParent) },
  { name: 'idle-sleeper', pid: String(sleeper) },
  { name: 'idle-parent-with-sleeping-child', pid: String(busyChildOfSleepingParent) },
  { name: 'nonexistent-pid', pid: '999999' },
  { name: 'non-numeric-pid', pid: 'abc' },
];

const shellVerdicts = (): string[] => {
  const stdin = subjects().map((one) => one.pid).join('\n') + '\n';
  const script = `
    . ${JSON.stringify(STATE_LIB)}
    while IFS= read -r pid; do
      printf '[%s]\\n' "$(plot_worker_activity "$pid")"
    done
  `;
  const out = execFileSync('bash', ['-c', script], { input: stdin, encoding: 'utf8', timeout: 60_000 });
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.slice(1, -1));
};

const ruleVerdict = async (pid: string): Promise<string> => {
  const n = Number(pid);
  const answer = await processesShell(shellContext(ROOT)).activity(Number.isNaN(n) ? Number.NaN : n);
  return answer.ok ? answer.value : 'failed';
};

describe('processesShell().activity agrees with plot_worker_activity', () => {
  it('exercises working, idle and the empty answer', () => {
    const shell = shellVerdicts();
    expect(shell).toContain('working');
    expect(shell).toContain('idle');
    expect(shell).toContain('');
  });

  it('answers what the shell answers on every subject', async () => {
    const shell = shellVerdicts();
    const found: Disagreement[] = [];
    const all = subjects();
    for (let i = 0; i < all.length; i += 1) {
      compareField(found, all[i].name, 'activity', await ruleVerdict(all[i].pid), shell[i]);
    }
    expect(found.map(report)).toEqual([]);
  });
});
