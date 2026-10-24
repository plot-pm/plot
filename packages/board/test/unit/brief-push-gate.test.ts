import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, briefPushGateOf, runGates } from '../../src/server/entry/gate.js';

const KEYS = ['PLOT_BRIEF_ONLY', 'PLOT_BRIEF_BRANCH'] as const;
let prior: Partial<Record<(typeof KEYS)[number], string>> = {};
let tmp = '';
beforeEach(() => {
  prior = Object.fromEntries(KEYS.flatMap((k) => (process.env[k] === undefined ? [] : [[k, process.env[k]]])));
  tmp = mkdtempSync(join(tmpdir(), 'plot-brief-push-'));
});
afterEach(() => {
  for (const k of KEYS) {
    if (prior[k] === undefined) delete process.env[k];
    else process.env[k] = prior[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** Runs the command only where the gate allows it, as the hook does. */
const gated = async (current: string, cwd: string, command: string): Promise<number> => {
  const gate = briefPushGateOf({ currentBranch: async () => current });
  const code = await runGates([gate], 'all', command, () => {});
  if (code === EXIT.allow) execFileSync('sh', ['-c', command], { cwd, stdio: 'ignore' });
  return code;
};

describe('the brief-push gate', () => {
  it('leaves no slice ref on the remote, and still lets the default branch through', async () => {
    const remote = join(tmp, 'remote.git');
    const work = join(tmp, 'work');
    execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
    execFileSync('git', ['init', '-b', 'main', work]);
    git(work, 'config', 'user.email', 't@t');
    git(work, 'config', 'user.name', 't');
    git(work, 'remote', 'add', 'origin', remote);
    git(work, 'commit', '--allow-empty', '-m', 'seed');
    process.env.PLOT_BRIEF_ONLY = '1';
    process.env.PLOT_BRIEF_BRANCH = 'bug/the-slice';

    git(work, 'checkout', '-b', 'bug/the-slice');
    git(work, 'commit', '--allow-empty', '-m', 'Started');
    expect(await gated('bug/the-slice', work, 'git push -u origin bug/the-slice')).toBe(EXIT.refuse);
    expect(await gated('bug/the-slice', work, 'git push')).toBe(EXIT.refuse);
    expect(git(work, 'ls-remote', '--heads', 'origin').trim()).toBe('');

    git(work, 'checkout', 'main');
    expect(await gated('main', work, 'git push origin main')).toBe(EXIT.allow);
    expect(git(work, 'ls-remote', '--heads', 'origin')).toContain('refs/heads/main');
    expect(git(work, 'ls-remote', '--heads', 'origin')).not.toContain('bug/the-slice');
  });

  it('allows everything outside a brief-only run', async () => {
    delete process.env.PLOT_BRIEF_ONLY;
    process.env.PLOT_BRIEF_BRANCH = 'bug/the-slice';
    const gate = briefPushGateOf({ currentBranch: async () => 'bug/the-slice' });
    expect(await runGates([gate], 'all', 'git push -u origin bug/the-slice', () => {})).toBe(EXIT.allow);
  });
});
