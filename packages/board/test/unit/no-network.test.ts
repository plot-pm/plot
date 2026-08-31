import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The board's plan walk runs on every /api/board request, and the client polls.
 * Sourcing plans from branches put git commands on that path, and there are two
 * ways to enumerate remote branches — one local, one over the wire:
 *
 *   git ls-remote --heads origin 'refs/heads/idea/*'    459.3 ms   ← network
 *   git for-each-ref refs/remotes/origin/idea/*           8.0 ms   ← local
 *
 * Measuring is NOT enough to catch the wrong one. At ~450 ms slower it would
 * pass any generous timing threshold while quietly making a poll loop depend on
 * the git host being reachable — the failure would show up as a board that
 * stalls on a VPN, months later. So the call itself is pinned.
 *
 * The local mirror is also already correct: the fleet scan fetches on its own
 * timer, so refs/remotes/origin/* is as fresh as the pulse.
 *
 * ## The calls moved; the guard follows them
 *
 * `board.ts` made these calls itself until 2026-08-31, when the read path moved
 * onto the `Refs` port and the git invocations went with it into `refs-git.ts`.
 * The QUESTION is unchanged — does the board reach the network to read refs? —
 * so the guard is repointed rather than deleted: the negative checks sweep the
 * server AND the adapter, and each positive check names the file that now holds
 * the call it pins.
 *
 * Pinning `board.ts` for `'for-each-ref'` after the move would have been a
 * check that fires on a refactor and passes on the regression, which is the
 * opposite of what it is for.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(here, '../../src/server');
/** Where the ref reads went. The port's git adapter is now the only caller. */
const REFS_ADAPTER = path.resolve(
  here, '../../../domain/src/adapters/refs/refs-git.ts',
);

/**
 * Comments are stripped before matching. The whole point of this file is to
 * find CALLS, and `board.ts` names `ls-remote` in prose precisely to record why
 * it is not used — a check that fired on the explanation would push the next
 * author to delete the reasoning in order to go green.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const read = (file: string, at: string) => ({
  file,
  text: fs.readFileSync(at, 'utf8'),
  code: stripComments(fs.readFileSync(at, 'utf8')),
});

const sources = [
  ...fs
    .readdirSync(SERVER_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => read(f, path.join(SERVER_DIR, f))),
  // Swept for the network calls alongside the server: the adapter is where the
  // ref reads live now, so a `ls-remote` introduced there would be exactly the
  // regression this file exists to catch.
  read('refs-git.ts', REFS_ADAPTER),
];

describe('the board never reaches the network to read refs', () => {
  it('calls no `ls-remote` anywhere in the server', () => {
    const offenders = sources.filter((s) => /ls-remote/.test(s.code));
    expect(offenders.map((s) => s.file)).toEqual([]);
  });

  it('calls no `git fetch` on the request path', () => {
    // The scan fetches on its own timer, which is what keeps the mirror fresh.
    // A fetch from here would put the same network dependency in a second place.
    const offenders = sources.filter((s) => /['"]fetch['"]/.test(s.code));
    expect(offenders.map((s) => s.file)).toEqual([]);
  });

  it('enumerates branches with `for-each-ref` over the local mirror', () => {
    // The positive half: not merely "no ls-remote", but that the intended call
    // is the one present — otherwise deleting the feature would pass too.
    //
    // The adapter holds the call and `board.ts` holds the PATTERN it asks for,
    // so both halves are pinned where each one lives. `board.ts` building
    // `refs/remotes/origin/<prefix>*` is what makes the read local; the adapter
    // running `for-each-ref` over it is what keeps it off the wire.
    const adapter = sources.find((s) => s.file === 'refs-git.ts');
    expect(adapter).toBeTruthy();
    expect(adapter!.code).toMatch(/'for-each-ref'/);
    const board = sources.find((s) => s.file === 'board.ts');
    expect(board).toBeTruthy();
    expect(board!.code).toMatch(/refs\/remotes\/origin\//);
  });

  it('reads plan content with `git show` against a local ref', () => {
    const adapter = sources.find((s) => s.file === 'refs-git.ts');
    expect(adapter!.code).toMatch(/'show'/);
  });

  it('reads branch names only in memoised helpers, never on a bare request path', () => {
    // Two branch reads happen in the server, each with its own TTL cache:
    //
    // 1. `server-info.ts`: The branch the SERVER serves from. Memoised at
    //    module level, TTL 5 s. Answers `server.branch` in the /api/board
    //    payload, which is no longer drawn in the header but still travels
    //    with the payload for UnreachableOverlay's sake.
    //
    // 2. `fleet.ts`: The branch the MAIN CHECKOUT is on — where the operator
    //    actually works, as distinct from whichever worktree the board server
    //    started in. Also TTL-memoised (5 s), because the main tree's branch
    //    can change while the server runs (the operator `git checkout`).
    //
    // Both are acceptable here because the fork stays OFF THE REQUEST PATH:
    // `git branch --show-current` fires at most once per TTL window, not once
    // per poll. The cost this test pins is the 4 s poll-loop × 8 ms fork ≈ 20%
    // blocking; a 5 s TTL cuts that to ≤ one fork per window and keeps the
    // rest of the polls from blocking at all.
    //
    // What is NOT acceptable: the call appearing in `index.ts` (the request
    // handler), `board.ts` (the per-request walker) or anywhere else that runs
    // on every poll. Those files remain forbidden.
    const allowed = new Set(['server-info.ts', 'fleet.ts']);
    // `refs-git.ts` is not allowed either, and is swept with the rest: the
    // adapter answers ref questions, and "which branch is checked out" is a
    // question about this WORKING TREE that no board read asks.
    const offenders = sources.filter(
      (s) => !allowed.has(s.file) && /--show-current/.test(s.code),
    );
    expect(offenders.map((s) => s.file)).toEqual([]);
    // The positive half: both expected files contain the call — deleting either
    // would pass the negative check while breaking the feature.
    const info = sources.find((s) => s.file === 'server-info.ts');
    const fleet = sources.find((s) => s.file === 'fleet.ts');
    expect(info!.code).toMatch(/--show-current/);
    expect(fleet!.code).toMatch(/--show-current/);
  });
});
