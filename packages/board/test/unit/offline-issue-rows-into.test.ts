import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueIndexFile } from '@plot-pm/domain/adapters';
import { ISSUE_INDEX_VERSION, type IssueIndex } from '@plot-pm/domain';
import { rmTree } from '../helpers.mjs';
import { freshCacheEntry, refreshIssues } from '../../src/server/fleet.js';

// #2384 and #2372: `offlineIssueRowsInto` must not set `entry.issueAt` on a
// path that leaves `entry.issues` untouched, and a failed poll that lands on
// neither memory nor the index must clear both together rather than leaving
// stale rows under no age.

const ACCOUNT = 'jwloka';

const temps: string[] = [];
beforeEach(() => {
  const budget = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-offline-issue-budget-'));
  temps.push(budget);
  vi.stubEnv('PLOT_BUDGET_HOME', budget);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) rmTree(dir);
});

/**
 * A scripts directory whose `plot-host.sh` records every call, answers
 * `spend-rate` with 100 an hour on {@link ACCOUNT}, prints `open` open rows for
 * `issue-list --paged` (or exits `openCode`), and answers every other op with
 * nothing. `withPlans` controls whether `docs/plans` exists at all — its
 * absence is how `ticketPlansOf` returns `null`.
 */
const fixture = ({
  open = 1,
  openCode = 0,
  withPlans = true,
}: { open?: number; openCode?: number; withPlans?: boolean } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-offline-issue-'));
  temps.push(dir);
  if (withPlans) fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}`);
    fs.chmodSync(path.join(dir, name), 0o755);
  };
  const rows = (n: number) =>
    `for i in $(seq 1 ${n}); do printf '{"number":%d,"title":"t%d","url":"u","createdAt":"2026-10-01T00:00:00Z"}\\n' "$i" "$i"; done`;
  write('plot-config.sh', `if [ "$2" = Tracker ]; then echo ''; else printf '%s\\n' "$3"; fi\n`);
  write('plot-plan-meta.sh', 'exit 0\n');
  write('plot-host.sh', [
    `printf '%s\\n' "$*" >> ${JSON.stringify(path.join(dir, 'host.calls'))}`,
    'case "$1" in',
    `  spend-rate) echo '{"perHour":100,"account":"${ACCOUNT}","limit":5000,"basis":"actual"}' ;;`,
    '  issue-list)',
    '    case " $* " in',
    '      *" --state closed "*) : ;;',
    `      *) ${openCode === 0 ? (open > 0 ? rows(open) : ':') : `echo boom >&2; exit ${openCode}`} ;;`,
    '    esac ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  return dir;
};

/** An answered index of `n` open issues numbered from 1, written for `source`. */
const indexOf = (n: number, source: IssueIndex['source'] = 'git-host'): IssueIndex => ({
  v: ISSUE_INDEX_VERSION,
  source,
  connector: 'github',
  account: ACCOUNT,
  requests: 1,
  nextAt: Date.now() + 120_000,
  backoffUntil: null,
  at: '2026-10-20T00:00:00.000Z',
  answer: 'answered',
  rows: Array.from({ length: n }, (_, i) => ({ number: String(i + 1), title: `issue ${i + 1}`, url: `u${i + 1}` })),
  complete: true,
});

describe('offlineIssueRowsInto pairs entry.issueAt with entry.issues (#2384)', () => {
  it('leaves entry.issueAt null where the index matches but the plans cannot be read', async () => {
    const dir = fixture({ openCode: 1, withPlans: false });
    const indexHome = path.join(dir, 'issue-index');
    fs.mkdirSync(indexHome, { recursive: true });
    vi.stubEnv('PLOT_ISSUE_INDEX_HOME', indexHome);
    await issueIndexFile({ home: indexHome }).write(indexOf(3));
    const entry = freshCacheEntry();

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(entry.issueAnswer).toBe('failed');
    expect(entry.issueAt).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('a failed poll clears the age and the rows together (#2372)', () => {
  it('clears entry.issues alongside entry.issueAt on a second failure with no index match', async () => {
    const entry = freshCacheEntry();

    // First failed poll: no prior answered read (`kept` is null — a fresh
    // entry has never set `issueConnector`), and the index matches this
    // fixture's own source (`git-host`, since no Tracker is declared) — the
    // fallback lands on `from: 'index'` and populates `entry.issues`.
    const firstFail = fixture({ openCode: 1 });
    const indexHome = path.join(firstFail, 'issue-index');
    fs.mkdirSync(indexHome, { recursive: true });
    vi.stubEnv('PLOT_ISSUE_INDEX_HOME', indexHome);
    await issueIndexFile({ home: indexHome }).write(indexOf(2, 'git-host'));
    await refreshIssues({ repoRoot: firstFail, scriptsDir: firstFail }, entry);
    expect(entry.issues).toHaveLength(2);
    expect(entry.issueAt).not.toBeNull();
    vi.unstubAllEnvs();

    // Second failed poll, same entry: `issueConnector` is still `github` from
    // the first call, so `kept` carries the first call's rows into `memory`
    // unless the connector changes between polls — `refreshIssues` only keeps
    // `entry.issueSets` where `entry.issueConnector === connector` (fleet.ts,
    // "Rows of another connector are not this read's to keep"). Forcing
    // `entry.issueConnector` to a value this poll's connector cannot match is
    // the direct way to make `kept` null again, so the index mismatch below
    // (written for `tracker`, while this fixture's own source is `git-host`)
    // can land on `from: 'none'`.
    entry.issueConnector = 'a connector this poll will never report';
    const secondFail = fixture({ openCode: 1 });
    const secondIndexHome = path.join(secondFail, 'issue-index');
    fs.mkdirSync(secondIndexHome, { recursive: true });
    vi.stubEnv('PLOT_ISSUE_INDEX_HOME', secondIndexHome);
    await issueIndexFile({ home: secondIndexHome }).write(indexOf(4, 'tracker'));

    await refreshIssues({ repoRoot: secondFail, scriptsDir: secondFail }, entry);

    expect(entry.issueAnswer).toBe('failed');
    expect(entry.issues).toEqual([]);
    expect(entry.issueAt).toBeNull();
    vi.unstubAllEnvs();
  });
});
