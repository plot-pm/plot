import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listingPagingFor } from '../src/adapters/host/listing-paging.js';
import { pagePossiblyTruncated } from '../src/rules/listing-page.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Does `pagePossiblyTruncated` answer what `plot-host.sh`'s
 * `pr_list_report_truncation` answers?
 *
 * `pr-list` runs on every board refresh, so the shell keeps its own copy of the
 * rule (docs/shell-and-domain.md). The corpus is BUILT: a stub `bb` and a stub
 * `gh` return a chosen number of rows for one state, and the shell's verdict is
 * whether it printed a truncation report for that state. The rule reads the
 * same case through `listingPagingFor`, so the two version tables are compared
 * too.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const report = describingAs({ left: 'rule', right: 'shell' });

/** One listing call: the host, the CLI version it reports, the limit and the rows. */
interface Case {
  readonly backend: 'github' | 'bitbucket';
  readonly version: string;
  readonly limit: number | null;
  readonly rows: number;
}

const ROWS = [0, 1, 20, 49, 50, 51, 100];
const LIMITS = [null, 20, 1000];

const CASES: readonly Case[] = [
  ...LIMITS.flatMap((limit) => ROWS.map((rows) => ({ backend: 'github' as const, version: '', limit, rows }))),
  ...['1.9.0', '1.10.0'].flatMap((version) =>
    LIMITS.flatMap((limit) => ROWS.map((rows) => ({ backend: 'bitbucket' as const, version, limit, rows })))),
];

let sandbox = '';

/** Writes an executable stub into `dir`. */
const stub = (dir: string, name: string, body: string): void => {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}`);
  chmodSync(join(dir, name), 0o755);
};

/** `rows` open pull requests in the shape the host CLI returns them. */
const page = (backend: Case['backend'], rows: number): string =>
  JSON.stringify(Array.from({ length: rows }, (_, i) => backend === 'github'
    ? { number: i + 1, title: `PR ${i + 1}`, state: 'OPEN', headRefName: `feature/pr-${i + 1}` }
    : { id: i + 1, title: `PR ${i + 1}`, state: 'OPEN', source: { branch: { name: `feature/pr-${i + 1}` } } }));

/** Whether the shell reported this case's page as possibly truncated. */
const shellVerdict = (one: Case, index: number): boolean => {
  const dir = mkdtempSync(join(sandbox, `case-${index}-`));
  const rows = page(one.backend, one.rows).replace(/'/g, `'\\''`);
  stub(dir, 'gh', `printf '%s' '${rows}'\n`);
  stub(dir, 'bb', [
    `if [[ "$*" == *"--version"* ]]; then echo 'bb ${one.version}'; exit 0; fi`,
    `if [[ "$*" == *"--help"* ]]; then echo 'bb pr list help'; exit 0; fi`,
    `printf '{"values":%s}' '${rows}'`,
    '',
  ].join('\n'));
  const args = ['pr-list', '--state', 'open', ...(one.limit === null ? [] : ['--limit', String(one.limit)])];
  const run = spawnSync('bash', [HOST, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PLOT_HOST: one.backend, PLOT_BUDGET_OFF: '1' },
  });
  if (run.status !== 0) throw new Error(`plot-host.sh exited ${run.status}: ${run.stderr}`);
  return /state=open possibly truncated/.test(run.stderr);
};

/** The rule's verdict on the same case. */
const ruleVerdict = (one: Case): boolean =>
  pagePossiblyTruncated({ limit: one.limit, rows: one.rows, paging: listingPagingFor(one.backend, one.version) });

const subject = (one: Case): string =>
  `${one.backend}${one.version === '' ? '' : ` bb ${one.version}`} limit=${one.limit ?? '-'} rows=${one.rows}`;

let verdicts: { one: Case; shell: boolean }[] = [];

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-listing-corpus-'));
  verdicts = CASES.map((one, i) => ({ one, shell: shellVerdict(one, i) }));
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('pagePossiblyTruncated agrees with plot-host.sh pr_list_report_truncation', () => {
  it('exercises both answers on both hosts, so this is not vacuous', () => {
    expect(verdicts.length).toBe(63);
    for (const backend of ['github', 'bitbucket']) {
      const answers = new Set(verdicts.filter((v) => v.one.backend === backend).map((v) => v.shell));
      expect([...answers].sort()).toEqual([false, true]);
    }
  });

  it('answers what the shell answers, on every case', () => {
    const found: Disagreement[] = [];
    for (const { one, shell } of verdicts) compareField(found, subject(one), 'truncated', ruleVerdict(one), shell);
    expect(found.map(report)).toEqual([]);
  });

  it('calls a short page from the measured bb complete, and one from an unmeasured bb not', () => {
    const at = (version: string): boolean | undefined =>
      verdicts.find((v) => v.one.backend === 'bitbucket' && v.one.version === version
        && v.one.limit === 1000 && v.one.rows === 20)?.shell;
    expect(at('1.9.0')).toBe(false);
    expect(at('1.10.0')).toBe(true);
  });
});
