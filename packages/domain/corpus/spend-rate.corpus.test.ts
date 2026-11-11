import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { budgetAccount } from '../src/adapters/budget/budget-account.js';
import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { readSpendRate, type SpendRateAnswer } from '../src/workflows/spend-rate.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Does `readSpendRate` over the `Budget` port's file adapter, with the account
 * `budgetAccount` names, answer what `plot-host.sh spend-rate` answers?
 *
 * fleetd reads the rate in process; the shell keeps its own reader for every
 * script. Each case writes one ledger into its own `PLOT_BUDGET_HOME`, asks the
 * shell, and asks the domain at the moment the shell read. The shell reads its
 * own clock, so that moment is derived from its answer: the oldest live line
 * plus the shell's `spanMs`. No line sits within a minute of a window boundary,
 * so both reads see the same live set.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const report = describingAs({ left: 'rule', right: 'shell' });
const MINUTE = 60_000;

/** One line `at` minutes before the case runs. */
interface Line {
  readonly ago: number;
  readonly connector?: string;
  readonly account?: string;
  readonly bucket?: string;
  readonly spent?: number;
  readonly limit?: number | null;
  readonly remaining?: number | null;
  /** Minutes after the run, negative for a reset that has passed. */
  readonly resetIn?: number | null;
  readonly basis?: string;
}

interface Case {
  readonly name: string;
  /** The `PLOT_HOST` the shell runs under. */
  readonly host: 'github' | 'bitbucket';
  /** `--connector`, where the caller names one. */
  readonly connector?: string;
  readonly current: readonly (Line | string)[] | null;
  readonly previous?: readonly (Line | string)[];
  /** Environment beyond the bare one; `ghUser` writes a `hosts.yml`. */
  readonly env?: Readonly<Record<string, string>>;
  readonly ghUser?: string;
  /** Runs the shell in a git repository whose `origin` is this URL. */
  readonly origin?: string;
}

const OVERRIDE = { PLOT_BUDGET_ACCOUNT: 'acme' };
const acme = (line: Omit<Line, 'account'>): Line => ({ account: 'acme', ...line });

const CASES: readonly Case[] = [
  { name: 'no record', host: 'github', current: null, env: OVERRIDE },
  { name: 'empty record', host: 'github', current: [], env: OVERRIDE },
  { name: 'one line', host: 'github', current: [acme({ ago: 5 })], env: OVERRIDE },
  {
    name: 'two buckets in one window',
    host: 'github',
    current: [acme({ ago: 40, bucket: 'core' }), acme({ ago: 20, bucket: 'graphql', spent: 3 }), acme({ ago: 10, bucket: 'core', spent: 2 })],
    env: OVERRIDE,
  },
  {
    name: 'a reset that passed starts the window',
    host: 'github',
    current: [acme({ ago: 50, bucket: 'core' }), acme({ ago: 30, bucket: 'graphql', resetIn: -20 }), acme({ ago: 10, bucket: 'core' })],
    env: OVERRIDE,
  },
  {
    name: 'a reset still ahead is reported and starts nothing',
    host: 'github',
    current: [acme({ ago: 45, resetIn: 15, remaining: 4100 }), acme({ ago: 25, resetIn: 35, remaining: 4000 })],
    env: OVERRIDE,
  },
  {
    name: 'an unknown line after a reading keeps the reading',
    host: 'github',
    current: [acme({ ago: 30, resetIn: 30 }), acme({ ago: 5, basis: 'unknown', limit: null, remaining: null, resetIn: null })],
    env: OVERRIDE,
  },
  {
    name: 'a predicted reading',
    host: 'github',
    current: [acme({ ago: 12, basis: 'predicted', remaining: 12 })],
    env: OVERRIDE,
  },
  {
    name: 'only unknown lines',
    host: 'github',
    current: [acme({ ago: 12, basis: 'unknown', limit: null, remaining: null }), acme({ ago: 6, basis: 'unknown', limit: null, remaining: null })],
    env: OVERRIDE,
  },
  {
    name: 'lines older than an hour are dead',
    host: 'github',
    current: [acme({ ago: 200 }), acme({ ago: 90 }), acme({ ago: 15 })],
    env: OVERRIDE,
  },
  {
    name: 'other accounts and connectors are not counted',
    host: 'github',
    current: [acme({ ago: 20 }), { ago: 15, account: 'someone' }, { ago: 10, connector: 'jira', account: 'acme' }],
    env: OVERRIDE,
  },
  {
    name: 'torn and blank lines are skipped',
    host: 'github',
    current: [acme({ ago: 20 }), '', 'b1\tgithub\tacme', 'b9\tgithub\tacme\tcore\t1\t1\t-\t-\t-\tactual', acme({ ago: 8 })],
    env: OVERRIDE,
  },
  {
    name: 'both generations are read',
    host: 'github',
    current: [acme({ ago: 10 })],
    previous: [acme({ ago: 35, bucket: 'graphql', spent: 4 })],
    env: OVERRIDE,
  },
  { name: 'the account from hosts.yml', host: 'github', current: [{ ago: 9, account: 'octo' }, acme({ ago: 7 })], ghUser: 'octo' },
  { name: 'no account at all', host: 'github', current: [{ ago: 9, account: 'unknown' }] },
  {
    name: 'the bitbucket owner',
    host: 'bitbucket',
    current: [{ ago: 9, connector: 'bitbucket', account: 'quatico', bucket: 'api', basis: 'unknown', limit: null, remaining: null }],
    origin: 'git@bitbucket.org:quatico/plot.git',
  },
  {
    name: 'jira keyed by the email digest',
    host: 'github',
    connector: 'jira',
    current: [{ ago: 9, connector: 'jira', account: `jira:${'0'.repeat(12)}`, bucket: 'api' }],
    env: { JIRA_EMAIL: 'someone@example.com' },
  },
];

const BARE = { PLOT_BUDGET_ACCOUNT: '', JIRA_EMAIL: '', PLOT_BUDGET_OFF: '1' };

const render = (line: Line | string, start: number): string => {
  if (typeof line === 'string') return line;
  const num = (v: number | null | undefined, fallback: number | null): string => {
    const value = v === undefined ? fallback : v;
    return value === null ? '-' : String(value);
  };
  const reset = line.resetIn === undefined || line.resetIn === null ? '-' : String(start + line.resetIn * MINUTE);
  return [
    'b1',
    line.connector ?? 'github',
    line.account ?? 'acme',
    line.bucket ?? 'core',
    String(start - line.ago * MINUTE),
    String(line.spent ?? 1),
    num(line.limit, 5000),
    num(line.remaining, 4990),
    reset,
    line.basis ?? 'actual',
  ].join('\t');
};

let sandbox = '';

interface Pair {
  readonly one: Case;
  readonly shell: Record<string, unknown>;
  readonly rule: SpendRateAnswer | null;
}

const ask = async (one: Case, index: number): Promise<Pair> => {
  const home = mkdtempSync(join(sandbox, `case-${index}-`));
  const cwd = join(home, 'cwd');
  mkdirSync(cwd);
  if (one.origin !== undefined) {
    execFileSync('git', ['init', '--quiet', cwd]);
    execFileSync('git', ['-C', cwd, 'remote', 'add', 'origin', one.origin]);
  }
  const gh = join(home, 'gh');
  mkdirSync(gh);
  if (one.ghUser !== undefined) writeFileSync(join(gh, 'hosts.yml'), `github.com:\n    git_protocol: ssh\n    user: ${one.ghUser}\n`);
  const email = one.env?.['JIRA_EMAIL'];
  const jiraAccount = email === undefined ? null : `jira:${execFileSync('shasum', ['-a', '256'], { input: email, encoding: 'utf8' }).slice(0, 12)}`;
  const start = Date.now();
  const lines = (set: readonly (Line | string)[]): string =>
    set.map((line) => render(typeof line === 'string' || line.connector !== 'jira' ? line : { ...line, account: jiraAccount ?? '' }, start)).join('\n') + '\n';
  if (one.current !== null) writeFileSync(join(home, 'budget.tsv'), one.current.length === 0 ? '' : lines(one.current));
  if (one.previous !== undefined) writeFileSync(join(home, 'budget.tsv.1'), lines(one.previous));
  const env = { ...BARE, ...one.env, PLOT_BUDGET_HOME: home, GH_CONFIG_DIR: gh, PLOT_HOST: one.host, GIT_CEILING_DIRECTORIES: sandbox };
  const run = spawnSync('bash', [HOST, 'spend-rate', ...(one.connector === undefined ? [] : ['--connector', one.connector])], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 20_000,
  });
  if (run.error) throw new Error(`plot-host.sh spend-rate did not finish: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`plot-host.sh spend-rate exited ${run.status}: ${run.stderr}`);
  const shell = JSON.parse(run.stdout) as Record<string, unknown>;
  const connector = one.connector ?? one.host;
  const account = await budgetAccount({ repoRoot: cwd, env })(connector);
  const record = budgetFile({ home });
  const readAt = Date.now();
  const first = await readSpendRate(record, connector, account, readAt);
  const shellSpanMs = typeof shell['spanMs'] === 'number' ? shell['spanMs'] : 0;
  // THE SHELL'S MOMENT: the rule's oldest live line plus the shell's span.
  const rule = first === null || first.spanMs === 0 ? first : await readSpendRate(record, connector, account, readAt - first.spanMs + shellSpanMs);
  return { one, shell, rule };
};

let pairs: Pair[] = [];

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-spend-rate-corpus-'));
  pairs = [];
  for (const [i, one] of CASES.entries()) pairs.push(await ask(one, i));
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

const FIELDS = ['connector', 'account', 'spent', 'spanMs', 'perHour', 'limit', 'remaining', 'resetAt', 'basis'] as const;

describe('readSpendRate agrees with plot-host.sh spend-rate', () => {
  it('exercises a rate, a null rate, a reading and no reading, so this is not vacuous', () => {
    const shells = pairs.map((p) => p.shell);
    expect(shells.some((s) => s['perHour'] === null)).toBe(true);
    expect(shells.some((s) => typeof s['perHour'] === 'number')).toBe(true);
    expect(shells.some((s) => s['basis'] === 'actual')).toBe(true);
    expect(shells.some((s) => s['basis'] === 'unknown')).toBe(true);
    expect(new Set(shells.map((s) => s['account'])).size).toBeGreaterThanOrEqual(4);
  });

  it('answers what the shell answers, field by field, on every case', () => {
    const found: Disagreement[] = [];
    for (const { one, shell, rule } of pairs) {
      if (rule === null) {
        compareField(found, one.name, 'read', 'failed', 'answered');
        continue;
      }
      for (const field of FIELDS) {
        const mine = field === 'perHour' && rule.perHour !== null ? Number(rule.perHour.toFixed(2)) : rule[field];
        compareField(found, one.name, field, mine, shell[field]);
      }
    }
    expect(found.map(report)).toEqual([]);
  });
});
