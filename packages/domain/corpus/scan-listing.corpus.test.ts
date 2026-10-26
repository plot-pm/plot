import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { foldScanListing, type ScanListingAnswer, type ScanListingRow } from '../src/rules/scan-listing.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * Does `foldScanListing`'s OPEN/MERGED rank answer what `plot-fleet-scan.sh`'s
 * `prefill_pr_states` answers, over one full-read payload?
 *
 * THE PAIR IS DECLARED BY THE PLAN (`the-fleet-scan-re-reads-all`, Listing
 * Delta slice), not discovered here: the fold's rank mirrors the shell's
 * `OPEN 1, MERGED 2, everything else 3` dedup by branch, deliberately, because
 * `fleet-scan.ts` reads the rule while `plot-fleet-scan.sh` still runs the
 * shell version on every scan pass. Neither side is authoritative — on a
 * disagreement the branch stops, and adjusting either side to force this test
 * to pass is the one move forbidden (CLAUDE.md, *A Shell Script Asks The
 * Domain*).
 *
 * THE COMPARISON RUNS THE REAL SCRIPT, not an extracted fragment. There is no
 * way to source `plot-fleet-scan.sh` and call `prefill_pr_states` alone — the
 * script has no `main` guard, and the function runs unconditionally near its
 * bottom. So this builds a disposable sandbox git repository, stubs `gh` on
 * `PATH` to answer the two `pr-list` calls `prefill_pr_states` makes, and runs
 * `plot-fleet-scan.sh --offline --list-eligible` with `PLOT_HOST=github` —
 * the same flag pair `production.ts`'s `readListEligible({fetch: false})`
 * uses, which reaches `HOST_LOOKUP_OK=1` through the `--list-eligible` branch
 * without a real git fetch.
 *
 * The shell's own key encoding (`_` → `__`, `/` → `_`) is read back off its
 * `listing:` stderr lines, which `report_listing` already emits in that
 * encoding — so the comparison does not re-implement the encoding, only reads
 * it.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const SCAN = join(ROOT, 'skills/plot/scripts/plot-fleet-scan.sh');
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

const WHOLE_OPEN =
  'plot-host: github pr-list state=open page complete (3 rows below requested limit 500) — this page holds every pull request the host has in this state';
const WHOLE_ALL =
  'plot-host: github pr-list state=all page complete (3 rows below requested limit 500) — this page holds every pull request the host has in this state';

/** One GitHub PR row, as both the stub `gh` and the rule's answer carry it. */
interface GhRow {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  head: string;
  updatedAt: string;
  draft?: boolean;
  checks?: string;
}

/** Encodes a branch name the way `cache_key`/`report_listing` do: `_` → `__`, `/` → `_`. */
const encodeKey = (branch: string): string => branch.replace(/_/g, '__').replace(/\//g, '_');

let sandbox = '';
let repo = '';

/** Writes an executable stub into `dir`. */
const stub = (dir: string, name: string, body: string): void => {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}`);
  chmodSync(join(dir, name), 0o755);
};

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-scan-listing-corpus-'));
  const bare = join(sandbox, 'bare.git');
  repo = join(sandbox, 'work');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo });
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: repo });
  for (const branch of ['feature/b1', 'feature/b2', 'feature/old-merged']) {
    execFileSync('git', ['checkout', '-q', '-b', branch, 'main'], { cwd: repo });
    writeFileSync(join(repo, `${branch.replace('/', '-')}.txt`), 'x\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', branch], { cwd: repo });
    execFileSync('git', ['push', '-q', 'origin', branch], { cwd: repo });
  }
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo });
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

/** The rich `pr list --state open` JSON row shape, as `plot-host.sh` emits it. */
const openRow = (row: GhRow): string => JSON.stringify({
  number: row.number, title: `PR ${row.number}`, state: row.state, headRefName: row.head,
  isDraft: row.draft ?? false, statusCheckRollup: [], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  reviewDecision: '', url: `https://example.invalid/${row.number}`, updatedAt: row.updatedAt,
  author: { login: 'a' }, headRefOid: 'deadbeef', mergedAt: null,
});

/** The plain `pr list --state all` JSON row shape, as `plot-host.sh` emits it. */
const plainRow = (row: GhRow): string => JSON.stringify({
  number: row.number, title: `PR ${row.number}`, state: row.state, headRefName: row.head,
  isDraft: row.draft ?? false, url: `https://example.invalid/${row.number}`, updatedAt: row.updatedAt,
  author: { login: 'a' }, headRefOid: 'deadbeef', mergedAt: row.state === 'MERGED' ? row.updatedAt : null,
});

/** One full-read case: the open-call rows and the all-call rows `gh` answers with. */
interface Case {
  name: string;
  openRows: readonly GhRow[];
  allRows: readonly GhRow[];
}

const CASES: readonly Case[] = [
  {
    name: 'a reused branch keeps OPEN over an older MERGED row',
    openRows: [{ number: 1, state: 'OPEN', head: 'feature/b1', updatedAt: '2026-10-26T10:00:00Z' }],
    allRows: [{ number: 2, state: 'MERGED', head: 'feature/b1', updatedAt: '2026-10-25T10:00:00Z' }],
  },
  {
    name: 'several branches rank independently',
    openRows: [{ number: 1, state: 'OPEN', head: 'feature/b1', updatedAt: '2026-10-26T10:00:00Z' }],
    allRows: [
      { number: 2, state: 'MERGED', head: 'feature/b2', updatedAt: '2026-10-25T09:00:00Z' },
      { number: 3, state: 'CLOSED', head: 'feature/old-merged', updatedAt: '2026-10-20T09:00:00Z' },
    ],
  },
  {
    name: 'an open PR with no terminal counterpart',
    openRows: [{ number: 1, state: 'OPEN', head: 'feature/b1', updatedAt: '2026-10-26T10:00:00Z' }],
    allRows: [],
  },
];

/** Runs the real shell against a stubbed `gh`, returning its parsed `listing:` rows. */
const shellListing = (
  one: Case,
  index: number,
): { verdict: 'ok' | 'failed'; rows: Map<string, { state: string }> } => {
  const dir = mkdtempSync(join(sandbox, `case-${index}-`));
  const openJson = `[${one.openRows.map(openRow).join(',')}]`;
  const allJson = `[${one.allRows.map(plainRow).join(',')}]`;
  stub(dir, 'gh', [
    'args="$*"',
    'if [[ "$args" == *"pr list --state open"* ]]; then',
    `  printf '%s' '${openJson.replace(/'/g, `'\\''`)}'`,
    `  echo '${WHOLE_OPEN}' >&2`,
    '  exit 0',
    'fi',
    'if [[ "$args" == *"pr list --state all"* ]]; then',
    `  printf '%s' '${allJson.replace(/'/g, `'\\''`)}'`,
    `  echo '${WHOLE_ALL}' >&2`,
    '  exit 0',
    'fi',
    'echo "unexpected gh call: $args" >&2',
    'exit 1',
  ].join('\n'));
  let stderr = '';
  try {
    execFileSync('bash', [SCAN, '--offline', '--list-eligible'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        PLOT_HOST: 'github',
        PLOT_BUDGET_OFF: '1',
      },
    });
  } catch (error) {
    // `--list-eligible` exits 1 for "nothing to start" whether or not the
    // listing itself answered — the same non-error exit `production.ts`'s
    // `readListEligible` already treats as an empty list. The `listing:`
    // lines this comparison reads are on stderr regardless of that exit code.
    stderr = (error as { stderr?: string }).stderr ?? '';
  }
  const rows = new Map<string, { state: string }>();
  for (const line of stderr.split('\n')) {
    const match = /^listing: (\S+)\t(OPEN|MERGED|CLOSED)\t/.exec(line);
    if (match === null) continue;
    const [, key, state] = match;
    if (key.startsWith('.') || key.includes('.json')) continue;
    rows.set(key, { state });
  }
  return { verdict: 'ok', rows };
};

/** The rule's answer to the same case, as a full read with nothing carried. */
const ruleListing = (one: Case): Map<string, { state: string }> => {
  const toRow = (row: GhRow): ScanListingRow => ({ head: row.head, state: row.state, updatedAt: row.updatedAt });
  const open: ScanListingAnswer = { verdict: 'ok', rows: one.openRows.map(toRow), stderr: WHOLE_OPEN };
  const rest: ScanListingAnswer = { verdict: 'ok', rows: one.allRows.map(toRow), stderr: WHOLE_ALL };
  const folded = foldScanListing(null, open, rest);
  const rows = new Map<string, { state: string }>();
  if (folded.ok) for (const row of folded.rows) rows.set(encodeKey(row.head), { state: row.state });
  return rows;
};

let shellByCase: { one: Case; rows: Map<string, { state: string }> }[] = [];

beforeAll(() => {
  shellByCase = CASES.map((one, i) => ({ one, rows: shellListing(one, i).rows }));
});

describe('foldScanListing agrees with plot-fleet-scan.sh prefill_pr_states', () => {
  it('exercises more than one branch per case, so this is not vacuous', () => {
    const totalRows = shellByCase.reduce((sum, { rows }) => sum + rows.size, 0);
    expect(totalRows).toBeGreaterThan(0);
  });

  it('produces the same listing lines, same key encoding, on every case', () => {
    const found: Disagreement[] = [];
    for (const { one, rows: shellRows } of shellByCase) {
      const ruleRows = ruleListing(one);
      const keys = new Set([...shellRows.keys(), ...ruleRows.keys()]);
      for (const key of keys) {
        compareField(
          found,
          `${one.name} :: ${key}`,
          'state',
          ruleRows.get(key)?.state ?? null,
          shellRows.get(key)?.state ?? null,
        );
      }
    }
    expect(found.map(report)).toEqual([]);
  });
});
