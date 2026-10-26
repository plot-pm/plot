import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { envelopeNextFor, listingPagingFor, walkToLimit } from '../src/adapters/host/listing-paging.js';
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
 *
 * `envelope` adds a THIRD dimension since #1757: whether the stub `bb`'s page
 * carries a `next` key, independent of `rows` and `version`. Every
 * pre-existing case is given `'present'` — a `next` key IS there — so the
 * envelope read backs off exactly as it would for any page that still names
 * a further one, and the version-table length test alone decides those cases'
 * verdicts, unmodified. `'absent'` is the new shape #1757 adds: no `next` key
 * in an otherwise-identical envelope, which must prove the page complete on
 * its own, for any version — including one the table never measured.
 *
 * With a limit, the shell walks `next` (`_bb_paged_walk`'s row-limit mode), and
 * the stub serves the same page at every path. So the rule reads the case
 * through `walkToLimit`, which models the walk's stop: the shell's row count is
 * the whole walk's, not one page's. `'unknown'` is an envelope with no `page`
 * key and no `next`: the walk reads one page, and only the version table's
 * page length can call it complete.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const report = describingAs({ left: 'rule', right: 'shell' });

type Envelope = 'present' | 'absent' | 'unknown';

/** One listing call: the host, the CLI version it reports, the limit, the rows and the envelope's own `next`. */
interface Case {
  readonly backend: 'github' | 'bitbucket';
  readonly version: string;
  readonly limit: number | null;
  readonly rows: number;
  readonly envelope: Envelope;
}

const ROWS = [0, 1, 20, 49, 50, 51, 100];
const LIMITS = [null, 20, 1000];

const CASES: readonly Case[] = [
  ...LIMITS.flatMap((limit) =>
    ROWS.map((rows) => ({ backend: 'github' as const, version: '', limit, rows, envelope: 'present' as const }))),
  ...['1.9.0', '1.10.0'].flatMap((version) =>
    LIMITS.flatMap((limit) =>
      ROWS.map((rows) => ({ backend: 'bitbucket' as const, version, limit, rows, envelope: 'present' as const })))),
  // #1757: an UNMEASURED version (absent from both BB_LIST_PAGE_VERSIONS and
  // BITBUCKET_PAGE_LENGTHS) whose envelope has no `next` key must read
  // complete regardless of row count — 9, 50 or 51 rows all prove the page
  // whole once the envelope itself says so.
  ...[0, 9, 50, 51].map((rows) => ({
    backend: 'bitbucket' as const, version: '1.11.1', limit: 1000, rows, envelope: 'absent' as const,
  })),
  // The same unmeasured version with `next` PRESENT must still read possibly
  // truncated — the envelope rule proves completeness only from absence.
  ...[9, 50].map((rows) => ({
    backend: 'bitbucket' as const, version: '1.11.1', limit: 1000, rows, envelope: 'present' as const,
  })),
  // A MEASURED version (1.9.0) with no `next` at the measured page length
  // (50 rows) must still read complete — proving the envelope path supersedes
  // the length test rather than only covering rows strictly below it.
  { backend: 'bitbucket' as const, version: '1.9.0', limit: 1000, rows: 50, envelope: 'absent' as const },
  // No envelope read: the walk stops after one page, and the version table's
  // page length alone decides.
  ...['1.9.0', '1.10.0'].flatMap((version) => [0, 20, 50].map((rows) => ({
    backend: 'bitbucket' as const, version, limit: 1000, rows, envelope: 'unknown' as const,
  }))),
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

/**
 * The raw `bb api` response shape for one case, `next` present or not.
 *
 * Carries `page` alongside `values`, as Bitbucket Cloud's real pagination
 * envelope always does (`packages/domain/src/adapters/host/listing-paging.ts`'s
 * `envelopeNextFor`): a `values`-only response with no `page` is a different,
 * narrower shape that never carries `next` regardless of total, so its
 * absence there must prove nothing.
 */
const bbResponse = (one: Case): string => {
  const rows = page(one.backend, one.rows);
  if (one.envelope === 'present') {
    return `{"values":${rows},"page":1,"next":"https://api.bitbucket.org/2.0/next-page"}`;
  }
  if (one.envelope === 'unknown') return `{"values":${rows}}`;
  return `{"values":${rows},"page":1}`;
};

/** Whether the shell reported this case's page as possibly truncated. */
const shellVerdict = (one: Case, index: number): boolean => {
  const dir = mkdtempSync(join(sandbox, `case-${index}-`));
  const ghRows = page(one.backend, one.rows).replace(/'/g, `'\\''`);
  const bbBody = (one.backend === 'bitbucket' ? bbResponse(one) : '{}').replace(/'/g, `'\\''`);
  stub(dir, 'gh', `printf '%s' '${ghRows}'\n`);
  stub(dir, 'bb', [
    `if [[ "$*" == *"--version"* ]]; then echo 'bb ${one.version}'; exit 0; fi`,
    `if [[ "$*" == *"--help"* ]]; then echo 'bb pr list help'; exit 0; fi`,
    `printf '%s' '${bbBody}'`,
    '',
  ].join('\n'));
  const args = ['pr-list', '--state', 'open', ...(one.limit === null ? [] : ['--limit', String(one.limit)])];
  const run = spawnSync('bash', [HOST, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PLOT_HOST: one.backend, PLOT_BUDGET_OFF: '1' },
    timeout: 20_000,
  });
  if (run.error) throw new Error(`plot-host.sh did not finish: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`plot-host.sh exited ${run.status}: ${run.stderr}`);
  return /state=open possibly truncated/.test(run.stderr);
};

/** What the shell's listing returned for this case: one page, or the walk over the stub's repeated page. */
const listed = (one: Case): { rows: number; envelopeNext: ReturnType<typeof envelopeNextFor> } => {
  if (one.backend === 'github') return { rows: one.rows, envelopeNext: 'unknown' };
  const page = { rows: one.rows, envelopeNext: envelopeNextFor(JSON.parse(bbResponse(one))) };
  if (one.limit === null) return page;
  return walkToLimit(Array.from({ length: Math.ceil(one.limit / 50) + 1 }, () => page), one.limit);
};

/** The rule's verdict on the same case. */
const ruleVerdict = (one: Case): boolean =>
  pagePossiblyTruncated({ limit: one.limit, paging: listingPagingFor(one.backend, one.version), ...listed(one) });

const subject = (one: Case): string =>
  `${one.backend}${one.version === '' ? '' : ` bb ${one.version}`} limit=${one.limit ?? '-'} rows=${
    one.rows} next=${one.envelope}`;

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
    expect(verdicts.length).toBe(76);
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

  it('calls a short page with no envelope from the measured bb complete, and one from an unmeasured bb not', () => {
    const at = (version: string): boolean | undefined =>
      verdicts.find((v) => v.one.backend === 'bitbucket' && v.one.version === version
        && v.one.limit === 1000 && v.one.rows === 20 && v.one.envelope === 'unknown')?.shell;
    expect(at('1.9.0')).toBe(false);
    expect(at('1.10.0')).toBe(true);
  });

  it('#2731: a walk that stops with a next named or trims a row reads possibly truncated', () => {
    const at = (limit: number, rows: number): boolean | undefined =>
      verdicts.find((v) => v.one.backend === 'bitbucket' && v.one.version === '1.9.0'
        && v.one.envelope === 'present' && v.one.limit === limit && v.one.rows === rows)?.shell;
    expect(at(20, 0)).toBe(true);
    expect(at(1000, 1)).toBe(true);
    expect(at(1000, 20)).toBe(true);
    expect(at(20, 50)).toBe(true);
  });

  it('#1757: an unmeasured bb version with no envelope next reads complete, any row count', () => {
    const at = (rows: number): boolean | undefined =>
      verdicts.find((v) => v.one.backend === 'bitbucket' && v.one.version === '1.11.1'
        && v.one.envelope === 'absent' && v.one.rows === rows)?.shell;
    expect(at(9)).toBe(false);
    expect(at(51)).toBe(false);
  });

  it('#1757: an unmeasured bb version with envelope next present still reads possibly truncated', () => {
    const at = (rows: number): boolean | undefined =>
      verdicts.find((v) => v.one.backend === 'bitbucket' && v.one.version === '1.11.1'
        && v.one.envelope === 'present' && v.one.rows === rows)?.shell;
    expect(at(9)).toBe(true);
    expect(at(50)).toBe(true);
  });

  it('#1757: the envelope path supersedes the page-length test, even at the measured length', () => {
    const at = verdicts.find((v) => v.one.backend === 'bitbucket' && v.one.version === '1.9.0'
      && v.one.envelope === 'absent' && v.one.rows === 50)?.shell;
    expect(at).toBe(false);
  });
});
