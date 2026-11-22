import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CardSchema, FleetSchema, FleetWaitingSchema } from '../../src/contract/schema.js';
import { freshCacheEntry, planTicketRowsOf, refreshIssues } from '../../src/server/fleet.js';
import { rmTree } from '../helpers.mjs';

/**
 * The payload carries the rows the Tickets section's scope groups read.
 *
 * Plan file: docs/plans/2026-11-20-tickets-show-what-the-sprint-delivers-and-found.md
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmTree(dir);
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const REVIEW_AT = 55;

/**
 * A repo whose `plot-host.sh` lists 60 open issues with no assignee, number
 * {@link REVIEW_AT} titled as a review finding, and closed issue 70. Its plan
 * parser reports each plan's `Issue:`, `State:` and `Branch:` lines.
 */
const fixture = (plans: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scope-rows-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}`);
    fs.chmodSync(path.join(dir, name), 0o755);
  };
  write('plot-config.sh', `if [ "$2" = Tracker ]; then echo ''; else printf '%s\\n' "$3"; fi\n`);
  write('plot-plan-meta.sh', [
    'for f in "$@"; do',
    '  n=$(sed -n \'s/^Issue: *#\\{0,1\\}\\([0-9]*\\).*/\\1/p\' "$f" | head -1)',
    '  st=$(sed -n \'s/^State: *//p\' "$f" | head -1)',
    '  br=$(sed -n \'s/^Branch: *//p\' "$f" | awk \'{printf "%s{\\"branch\\":\\"%s\\"}", (NR>1?",":""), $1}\')',
    '  printf \'{"file":"%s","format":"canonical","phase":"%s","issues":[%s],"waves":[{"branches":[%s]}]}\\n\' "$f" "${st:-draft}" "$n" "$br"',
    'done',
    '',
  ].join('\n'));
  write('plot-host.sh', [
    'case "$1" in',
    "  account) echo 'jwloka' ;;",
    '  issue-list)',
    '    case " $* " in',
    `      *" --state closed "*) printf '{"number":70,"title":"a closed ticket","url":"u","createdAt":"2026-10-01T00:00:00Z","closedAt":"%s","assignees":[]}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ;;`,
    '      *" --state inbox "*) : ;;',
    '      *) for i in $(seq 1 60); do',
    `           if [ "$i" = ${REVIEW_AT} ]; then t="plot-review: findings on PR #3583"; else t="t$i"; fi`,
    '           printf \'{"number":%d,"title":"%s","url":"u","createdAt":"2026-10-01T00:00:00Z","assignees":[]}\\n\' "$i" "$t"',
    '         done ;;',
    '    esac ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  for (const [file, body] of Object.entries(plans)) fs.writeFileSync(path.join(dir, 'docs', 'plans', file), body);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
};

const entryOf = () => {
  const entry = freshCacheEntry();
  entry.backend = 'github';
  return entry;
};

describe('planTicketRows from one issue read', () => {
  it('keeps a ticket a plan names with its title, a closed one as closed, and a review finding past the inbox cut', async () => {
    const dir = fixture({
      'a.md': '# plan\n\nIssue: #1\nState: approved\nBranch: b/one\n',
      'c.md': '# plan\n\nIssue: #70\nState: delivered\nBranch: b/two\n',
    });
    const entry = entryOf();

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);
    const rows = planTicketRowsOf(entry.issueSets, entry.ticketPlans, new Set(), Date.now());

    expect(rows.map((r) => [r.number, r.state])).toEqual([['1', 'open'], [String(REVIEW_AT), 'open'], ['70', 'closed']]);
    expect(rows[0]?.title).toBe('t1');
    expect(rows.every((r) => r.complete)).toBe(true);
    // The inbox stops at 50 rows; the review finding at row 55 is past it.
    expect(entry.issues.map((r) => r.number)).not.toContain(String(REVIEW_AT));
  });

  it('keeps a row a refuted claim names, and none where the sets are unread', () => {
    const sets = { rows: [{ number: '9', title: 'unplanned', url: 'u', createdAt: '2026-10-01T00:00:00Z' }], complete: false };
    const rows = planTicketRowsOf(sets as never, new Map(), new Set(['9']), Date.now());
    expect(rows.map((r) => [r.number, r.state, r.complete])).toEqual([['9', 'open', false]]);
    expect(planTicketRowsOf(sets as never, new Map(), new Set(), Date.now())).toEqual([]);
    expect(planTicketRowsOf(null, new Map(), new Set(['9']), Date.now())).toEqual([]);
  });

  it('keeps a refuted-claim row by its title where no board build has filled the refuted keys', () => {
    const sets = { rows: [
      { number: '12', title: 'Refuted claim of a-plan: the board shows it', url: 'u', createdAt: '2026-10-01T00:00:00Z' },
      { number: '13', title: 'unrelated', url: 'u', createdAt: '2026-10-01T00:00:00Z' },
    ], complete: true };
    const entry = freshCacheEntry();
    expect(entry.refutedIssues.size).toBe(0);
    const rows = planTicketRowsOf(sets as never, null, entry.refutedIssues, Date.now());
    expect(rows.map((r) => [r.number, r.state])).toEqual([['12', 'open']]);
  });

  it('lists a key once, as open, where the open and closed sets both hold it', () => {
    const row = { number: '4', title: 'plot-review: findings on PR #1', url: 'u', createdAt: '2026-10-01T00:00:00Z' };
    const rows = planTicketRowsOf({ rows: [row], closed: { rows: [row] } } as never, null, new Set(), Date.now());
    expect(rows.map((r) => [r.number, r.state])).toEqual([['4', 'open']]);
  });
});

describe('ticketPlans from the same plans read', () => {
  it('carries an Approved plan with 1 of 2 slices merged, and merged null where the pulse lacks the plan', async () => {
    const dir = fixture({
      'a.md': '# plan\n\nIssue: #1\nState: approved\nBranch: b/one\nBranch: b/two\n',
      'b.md': '# plan\n\nIssue: #2\nState: approved\nBranch: b/three\nBranch: b/four\n',
    });
    const entry = entryOf();
    const wave = (states: [string, string][]) => ({ branches: states.map(([branch, state]) => ({ branch, state })) });
    entry.pulse = { plans: [{ file: 'a.md', slices: [wave([['b/one', 'merged'], ['b/two', 'open']])] }] } as never;

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);
    const plans = Object.fromEntries(entry.ticketPlans ?? []);

    expect(plans['1']).toEqual([expect.objectContaining({ state: 'approved', total: 2, merged: 1 })]);
    expect(plans['2']).toEqual([expect.objectContaining({ state: 'approved', total: 2, merged: null })]);
  });
});

describe('waiting names the keys behind its counts', () => {
  it('lists an unassigned review finding past the shown rows in unassignedKeys', async () => {
    const dir = fixture({});
    const entry = entryOf();

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(entry.waiting?.unassignedKeys).toContain(String(REVIEW_AT));
    expect(entry.waiting?.unassignedKeys).toHaveLength(entry.waiting?.unassigned ?? -1);
    expect(entry.waiting?.assignedToOthersKeys).toEqual([]);
  });
});

describe('the contract defaults the new fields', () => {
  it('parses a payload from an older server with empty answers', () => {
    const fleet = FleetSchema.parse({
      generatedAt: '2026-11-20T00:00:00Z', ageSeconds: 1, ready: true, error: null,
      rows: [],
      summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
      stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
      prAgeSeconds: null, prError: null,
    });
    expect(fleet.planTicketRows).toEqual([]);
    expect(fleet.ticketPlans).toEqual({});
  });

  it('defaults the waiting keys and a card\'s refuted issues to empty lists', () => {
    const waiting = FleetWaitingSchema.parse({ tickets: [], shown: 0, unassigned: 0, assignedToOthers: 0, complete: true });
    expect(waiting.unassignedKeys).toEqual([]);
    expect(waiting.assignedToOthersKeys).toEqual([]);
    const shape = CardSchema.shape.refutedIssues;
    expect(shape.parse(undefined)).toEqual([]);
  });
});
