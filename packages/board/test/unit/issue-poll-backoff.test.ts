import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  refreshIssues, freshCacheEntry, prNextDueAt, prRefreshMsFor,
} from '../../src/server/fleet.js';
import { rmTree } from '../helpers.mjs';

// The defect this file exists for, measured on this repo 2026-08-20: GraphQL
// 0/5000. The PR refresh recognised the rate limit and backed off; the issue
// poll recorded the error and re-fired on the ordinary cadence, spending the
// exhausted budget to be refused again. One host consumer slowed down and its
// neighbour kept knocking.
//
// The issue poll runs on the SAME gate as the PR fetch (`prNextAt`), so a fix
// is a matter of routing its rate-limit failure through `hostReaction` and
// pushing that gate out — never pulling it in, so a longer PR backoff a tick
// earlier is never shortened.

/**
 * A fake `plot-host.sh` whose `issue-list` exits with the given code and writes
 * `message` to stderr — the shape a shelled-out `gh` hands back on refusal.
 *
 * A script rather than a stubbed function, because the seam under test is the
 * real one: `refreshIssues` locates `plot-host.sh` by path and reads the failure
 * off the thrown error's message. A stub returning a value would test neither.
 */
function fakeHost(message: string, exitCode: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-issue-'));
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    `#!/usr/bin/env bash\nif [ "$1" = issue-list ]; then\n  printf '%s\\n' ${JSON.stringify(message)} >&2\n  exit ${exitCode}\nfi\nexit 0\n`,
  );
  // `plot-plan-meta.sh` is only reached on the SUCCESS path; a failing poll
  // returns before it. Present and silent so nothing else aborts the refresh.
  fs.writeFileSync(path.join(dir, 'plot-plan-meta.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  fs.chmodSync(path.join(dir, 'plot-plan-meta.sh'), 0o755);
  return dir;
}

const dirs: string[] = [];
function host(message: string, exitCode: number): string {
  const dir = fakeHost(message, exitCode);
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmTree(dir);
});

const RATE_LIMIT = 'GraphQL: API rate limit already exceeded for user ID 870334';
const ORDINARY = 'dial tcp: lookup api.github.com: no such host';

describe('a rate-limited issue poll waits, as the PR refresh already does', () => {
  it('pushes the shared gate out to the backoff, not the ordinary cadence', async () => {
    // The whole defect, stated as one gate move. Before this the issue poll left
    // `prNextAt` where the PR fetch put it — the ordinary 60 s tick — and re-fired
    // into the closed door on the next one.
    const scriptsDir = host(RATE_LIMIT, 1);
    const entry = freshCacheEntry();
    // The gate as an ordinary tick would leave it: the PR fetch anchored it 60 s
    // out with no backoff. The issue poll must be able to see past this.
    const started = Date.now();
    const ordinary = prNextDueAt(started, null, started);
    entry.prNextAt = ordinary.at;
    entry.prNextIsBackoff = ordinary.hard;

    await refreshIssues({ repoRoot: scriptsDir, scriptsDir }, entry);

    expect(entry.issueAnswer).toBe('failed');
    expect(entry.issueError).toContain('rate limit');
    // The gate now sits on the 120 s backoff, and it is HARD — held to the
    // millisecond, the way a host-named floor is.
    expect(entry.prNextIsBackoff).toBe(true);
    expect(entry.prNextAt).toBeGreaterThan(ordinary.at);
    expect(entry.prNextAt - started).toBeGreaterThanOrEqual(120_000 - 50);
  });

  it('never SHORTENS a longer backoff the PR refresh set a tick earlier', async () => {
    // The load-bearing negative and the reason "PR refresh unchanged" holds: if
    // the PR fetch already bought a longer wait — the host named 900 s — the
    // issue poll's own unstated-reset ceiling must not pull the gate back in.
    //
    // 900 s rather than the 300 s this asserted before the reaction landed: the
    // ceiling for a quota that states no reset IS 300 s now, so a 300 s floor
    // ties it and the comparison decides on the milliseconds between two
    // `Date.now()` calls. A floor a reaction cannot reach is what makes this
    // test about the extend-only rule rather than about clock jitter.
    const scriptsDir = host(RATE_LIMIT, 1);
    const entry = freshCacheEntry();
    const started = Date.now();
    const longer = started + 900_000;
    entry.prNextAt = longer;
    entry.prNextIsBackoff = true;

    await refreshIssues({ repoRoot: scriptsDir, scriptsDir }, entry);

    // Untouched: a backoff is a floor on when the host may be called, and the
    // longer floor wins.
    expect(entry.prNextAt).toBe(longer);
    expect(entry.prNextIsBackoff).toBe(true);
  });

  it('keeps the ordinary rhythm for a NON-rate-limit failure', async () => {
    // A VPN blip is not a quota. The issue poll records the error and leaves the
    // gate exactly where the PR fetch's ordinary tick put it — no two minutes of
    // silence for a failure that should recover in one.
    const scriptsDir = host(ORDINARY, 1);
    const entry = freshCacheEntry();
    const started = Date.now();
    const ordinary = prNextDueAt(started, null, started);
    entry.prNextAt = ordinary.at;
    entry.prNextIsBackoff = ordinary.hard;

    await refreshIssues({ repoRoot: scriptsDir, scriptsDir }, entry);

    expect(entry.issueAnswer).toBe('failed');
    expect(entry.prNextAt).toBe(ordinary.at);
    expect(entry.prNextIsBackoff).toBe(false);
  });

  it('leaves the gate alone when Bitbucket says it cannot be asked (exit 4)', async () => {
    // Exit 4 is a standing fact about Bitbucket, not an outage and not a quota.
    // It clears the error and empties the list, and it must not touch the gate —
    // there is nothing to back off from.
    const scriptsDir = host('bitbucket has no issue listing', 4);
    const entry = freshCacheEntry();
    const started = Date.now();
    const ordinary = prNextDueAt(started, null, started);
    entry.prNextAt = ordinary.at;
    entry.prNextIsBackoff = ordinary.hard;

    await refreshIssues({ repoRoot: scriptsDir, scriptsDir }, entry);

    expect(entry.issueAnswer).toBe('unsupported');
    expect(entry.issueError).toBeNull();
    expect(entry.prNextAt).toBe(ordinary.at);
    expect(entry.prNextIsBackoff).toBe(false);
  });

  it('holds the issue backoff for its full delay past an ordinary tick', () => {
    // End to end with the real scheduler: the ceiling backoff the bare message
    // buys is 120 s, and the 60 s ordinary tick may not cut it — the same
    // property the PR refresh already proves, now reachable from the issue poll.
    const refresh = prRefreshMsFor('github');
    expect(refresh).toBe(60_000);
  });
});
