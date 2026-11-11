import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bitbucketBudgetAccount } from '../src/rules/bitbucket-budget-account.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Does `bitbucketBudgetAccount` answer what `plot-host.sh`'s
 * `budget_account bitbucket` answers?
 *
 * The in-process Bitbucket client and the shell charge one ledger key, the
 * `origin` remote's workspace. Each case sets `remote.origin.url` in a scratch
 * repository, asks the shell function there, and asks the rule over the same
 * URL.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const report = describingAs({ left: 'rule', right: 'shell' });

interface Case {
  readonly name: string;
  /** The `remote.origin.url` value, or null for a repository with no `origin`. */
  readonly url: string | null;
  /** The value of `PLOT_BUDGET_ACCOUNT`, or undefined where it is unset. */
  readonly override?: string;
}

const CASES: readonly Case[] = [
  { name: 'scp form', url: 'git@bitbucket.org:quatico/portal.git' },
  { name: 'scp form without .git', url: 'git@bitbucket.org:quatico/portal' },
  { name: 'https with a user', url: 'https://jwloka@bitbucket.org/quatico/ewz-kus-portal.git' },
  { name: 'https without .git', url: 'https://bitbucket.org/quatico/portal' },
  { name: 'ssh with a port', url: 'ssh://git@bitbucket.org:22/quatico/portal.git' },
  { name: 'a workspace with digits and dashes', url: 'git@bitbucket.org:team-42/repo.name.git' },
  { name: 'a trailing slash keeps the line whole', url: 'https://bitbucket.org/quatico/portal/' },
  { name: 'a local path', url: '/tmp/census/origin.git' },
  { name: 'a bare word keeps the line whole', url: 'portal' },
  { name: 'no origin', url: null },
  { name: 'the override wins', url: 'git@bitbucket.org:quatico/portal.git', override: 'census' },
  { name: 'an empty override is unset', url: 'git@bitbucket.org:quatico/portal.git', override: '' },
  { name: 'the override with no origin', url: null, override: 'census' },
];

let sandbox = '';
let shellValues: string[] = [];

/** The text of `budget_account`, lifted from `plot-host.sh`. */
const shellFunction = (): string => {
  const run = spawnSync('awk', ['/^budget_account\\(\\) \\{/{on=1} on{print} on&&/^\\}/{on=0}', HOST], { encoding: 'utf8' });
  if (run.status !== 0 || run.stdout === '') throw new Error(`could not lift budget_account: ${run.stderr}`);
  return run.stdout;
};

/** The shell's `budget_account bitbucket` in a repository whose origin is the case's URL. */
const shellAccount = (one: Case, index: number, text: string): string => {
  const repo = join(sandbox, `repo-${index}`);
  const init = spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`git init: ${init.stderr}`);
  if (one.url !== null) {
    const set = spawnSync('git', ['-C', repo, 'remote', 'add', 'origin', one.url], { encoding: 'utf8' });
    if (set.status !== 0) throw new Error(`git remote add: ${set.stderr}`);
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['PLOT_BUDGET_ACCOUNT'];
  if (one.override !== undefined) env['PLOT_BUDGET_ACCOUNT'] = one.override;
  const run = spawnSync('bash', ['-c', `${text}\nbudget_account bitbucket`], { cwd: repo, env, encoding: 'utf8', timeout: 20_000 });
  if (run.error) throw new Error(`budget_account did not finish: ${run.error.message}`);
  return run.stdout.replace(/\n$/, '');
};

beforeAll(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'plot-bitbucket-account-corpus-')));
  const text = shellFunction();
  shellValues = CASES.map((one, i) => shellAccount(one, i, text));
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('bitbucketBudgetAccount agrees with plot-host.sh budget_account bitbucket', () => {
  it('exercises a workspace, a whole line, the override and unknown, so this is not vacuous', () => {
    expect(shellValues).toContain('quatico');
    expect(shellValues).toContain('portal');
    expect(shellValues).toContain('census');
    expect(shellValues).toContain('unknown');
  });

  it('answers what the shell answers on every recorded remote', () => {
    const found: Disagreement[] = [];
    CASES.forEach((one, i) =>
      compareField(found, one.name, 'account', bitbucketBudgetAccount(one.url, one.override), shellValues[i] ?? ''),
    );
    expect(found.map(report)).toEqual([]);
  });
});
