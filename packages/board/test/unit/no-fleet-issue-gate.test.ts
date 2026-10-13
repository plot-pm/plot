import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTree } from '../helpers.mjs';

const rates = vi.hoisted(() => ({ calls: [] as Array<{ gate: unknown; result: unknown }> }));
vi.mock('@plot-pm/domain', async (importOriginal) => {
  const real = await importOriginal<typeof import('@plot-pm/domain')>();
  const cadenceRateOf = ((...args: Parameters<typeof real.cadenceRateOf>) => {
    const result = real.cadenceRateOf(...args);
    rates.calls.push({ gate: args[1], result });
    return result;
  }) as typeof real.cadenceRateOf;
  return { ...real, cadenceRateOf };
});

import { freshCacheEntry, maybeRefreshPrs, refreshIssues, type CacheEntry } from '../../src/server/fleet.js';

// The board's own issue gate with no fleet (D28, review findings M2 and M3 of
// PR #1657): the PR pass subtracts the gate's spend and holds on its backoff,
// the PR tick skips the issue read while the gate is shut, and the read keeps
// every open row and the closed set unfiltered on the entry.

const ACCOUNT = 'jwloka';

const temps: string[] = [];
beforeEach(() => {
  rates.calls.length = 0;
  const budget = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-issue-gate-budget-'));
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
 * `issue-list --paged` (or exits `openCode`), `closed` closed rows for
 * `--state closed`, and answers every other op with nothing.
 */
const fixture = ({ open = 1, closed = 0, openCode = 0 }: { open?: number; closed?: number; openCode?: number } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-issue-gate-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}`);
    fs.chmodSync(path.join(dir, name), 0o755);
  };
  const rows = (n: number, extra: string) =>
    `for i in $(seq 1 ${n}); do printf '{"number":%d,"title":"t%d","url":"u","createdAt":"2026-10-01T00:00:00Z"${extra}}\\n' "$i" "$i"; done`;
  write('plot-config.sh', `if [ "$2" = Tracker ]; then echo ''; else printf '%s\\n' "$3"; fi\n`);
  write('plot-plan-meta.sh', 'exit 0\n');
  write('plot-host.sh', [
    `printf '%s\\n' "$*" >> ${JSON.stringify(path.join(dir, 'host.calls'))}`,
    'case "$1" in',
    `  spend-rate) echo '{"perHour":100,"account":"${ACCOUNT}","limit":5000,"basis":"actual"}' ;;`,
    '  issue-list)',
    '    case " $* " in',
    `      *" --state closed "*) ${closed > 0 ? rows(closed, ',"closedAt":"2026-10-12T00:00:00Z"') : ':'} ;;`,
    `      *) ${openCode === 0 ? (open > 0 ? rows(open, '') : ':') : `echo boom >&2; exit ${openCode}`} ;;`,
    '    esac ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  return dir;
};

const calls = (dir: string): string[] => {
  const file = path.join(dir, 'host.calls');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
};

/** An entry whose PR gate is open and whose issue gate holds `over`. */
const entryWith = (over: Partial<CacheEntry>): CacheEntry => ({
  ...freshCacheEntry(),
  backend: 'github',
  issueConnector: 'github',
  issueAccount: ACCOUNT,
  ...over,
});

describe('the PR pass reads the board\'s own issue gate', () => {
  it('hands cadenceRateOf the entry\'s reading and schedules on the subtracted rate', async () => {
    const dir = fixture();
    const nextAt = Date.now() + 360_000;
    const entry = entryWith({ issueRequests: 3, issueNextAt: nextAt, issueBackoffUntil: null });

    await maybeRefreshPrs({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(rates.calls[0]?.gate).toEqual({
      connector: 'github', account: ACCOUNT, requests: 3, nextAt, backoffUntil: null,
    });
    expect(rates.calls[0]?.result).toMatchObject({ perHour: 70 });
    expect(calls(dir).some((call) => call.startsWith('pr-list'))).toBe(true);
  });

  it('holds the PR pass on a live issue backoff of the same connector and account', async () => {
    const dir = fixture();
    const until = Date.now() + 300_000;
    const entry = entryWith({ issueRequests: 1, issueNextAt: until, issueNextIsBackoff: true, issueBackoffUntil: until });

    await maybeRefreshPrs({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(calls(dir).filter((call) => call.startsWith('pr-list') || call.startsWith('issue-list'))).toEqual([]);
    expect(entry.prNextAt).toBe(until);
    expect(entry.prNextIsBackoff).toBe(true);
  });
});

describe('the PR tick and the issue gate', () => {
  it('asks no issue-list while issueNextAt is in the future', async () => {
    const dir = fixture();
    const entry = entryWith({ issueRequests: 2, issueNextAt: Date.now() + 240_000 });

    await maybeRefreshPrs({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(calls(dir).filter((call) => call.startsWith('issue-list'))).toEqual([]);
  });

  it('reads the issues once issueNextAt has passed', async () => {
    const dir = fixture();
    const entry = entryWith({ issueRequests: 2, issueNextAt: Date.now() - 1 });

    await maybeRefreshPrs({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(calls(dir).filter((call) => call.startsWith('issue-list'))[0]).toBe('issue-list --paged --limit 1000');
  });
});

describe('the no-fleet read keeps the fold\'s rows', () => {
  it('keeps every open row and the closed set unfiltered, and caps only the inbox', async () => {
    const dir = fixture({ open: 120, closed: 2 });
    const entry = freshCacheEntry();
    const before = Date.now();

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(entry.issueSets?.answer).toBe('answered');
    expect(entry.issueSets?.rows).toHaveLength(120);
    expect(entry.issueSets?.complete).toBe(true);
    expect(entry.issueSets?.closed?.answer).toBe('answered');
    expect(entry.issueSets?.closed?.rows).toHaveLength(2);
    expect(entry.issues).toHaveLength(50);
    // 2 open pages and 1 closed page.
    expect(entry.issueRequests).toBe(3);
    expect(entry.issueNextAt).toBeGreaterThanOrEqual(before + 360_000);
    expect(calls(dir).filter((call) => call.startsWith('issue-list'))).toEqual([
      'issue-list --paged --limit 1000',
      expect.stringMatching(/^issue-list --state closed --since \S+ --limit 1000$/),
    ]);
  });

  it('keeps the earlier rows and closed set where the open read fails', async () => {
    const answered = fixture({ open: 3, closed: 1 });
    const entry = freshCacheEntry();
    await refreshIssues({ repoRoot: answered, scriptsDir: answered }, entry);
    const before = entry.issueSets;

    const failing = fixture({ openCode: 1 });
    await refreshIssues({ repoRoot: failing, scriptsDir: failing }, entry);

    expect(entry.issueAnswer).toBe('failed');
    expect(entry.issueSets?.answer).toBe('failed');
    expect(entry.issueSets?.reason).toBe('boom');
    expect(entry.issueSets?.rows).toEqual(before?.rows);
    expect(entry.issueSets?.closed).toEqual(before?.closed);
    expect(entry.issueSets?.at).toBe(before?.at);
    expect(entry.issueRequests).toBe(1);
  });
});
