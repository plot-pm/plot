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
 * Where the two BRANCH reads went, on 2026-09-01.
 *
 * A branch reading is a question about a CHECKOUT rather than about a ref,
 * which is why it landed on `Trees` and not on `Refs` — and why `refs-git.ts`
 * is still swept below as a file that must not ask it.
 */
const TREES_ADAPTER = path.resolve(
  here, '../../../domain/src/adapters/trees/trees-git.ts',
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
  // Swept for the same reason, and holding the branch reads the server used to
  // make itself.
  read('trees-git.ts', TREES_ADAPTER),
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

  it('reads branch names through the port, never on a bare request path', () => {
    // TWO BRANCH READINGS HAPPEN IN THE SERVER, and neither spawns any more.
    //
    // 1. `server-info.ts`: the branch the SERVER serves from, answering
    //    `server.branch` in the /api/board payload — no longer drawn in the
    //    header, but still travelling with the payload for
    //    UnreachableOverlay's sake. Reads `Trees.currentBranch(repoRoot)`.
    //
    // 2. `fleet.ts`: the branch the MAIN CHECKOUT is on — where the operator
    //    actually works, as distinct from whichever worktree the board server
    //    started in. Reads `Trees.list()` and takes the `isMain` entry, which
    //    is one call where it used to be two spawns.
    //
    // Both keep their 5 s TTL, and the TTL now saves a process launch rather
    // than a blocked event loop: `execFileSync` cannot yield, so until
    // 2026-09-01 a static file could time out at 15 s beside one of these.
    //
    // THE GUARD FOLLOWS THE CALLS. `git branch --show-current` lives in
    // `trees-git.ts`, so that is the only file allowed to name it, and every
    // server file is forbidden — including `server-info.ts` and `fleet.ts`,
    // which held it until this migration. Leaving them on the allowlist would
    // be a check that passes when the spawn comes back.
    const offenders = sources.filter(
      (s) => s.file !== 'trees-git.ts' && /--show-current/.test(s.code),
    );
    expect(offenders.map((s) => s.file)).toEqual([]);
    // The positive half: the adapter holds the call, and each server file holds
    // the port question it asks — otherwise deleting the feature would pass too.
    const trees = sources.find((s) => s.file === 'trees-git.ts');
    const info = sources.find((s) => s.file === 'server-info.ts');
    const fleet = sources.find((s) => s.file === 'fleet.ts');
    expect(trees!.code).toMatch(/'--show-current'/);
    expect(info!.code).toMatch(/currentBranch\(opts\.repoRoot\)/);
    expect(fleet!.code).toMatch(/treesFor\(opts\)\.list\(\)/);
  });

  it('runs no synchronous spawn in the two files this wave migrated', () => {
    // THE MEASUREMENT THAT FOUND THE DEFECT, pinned as a call. `sample <pid> 5`
    // on a wedged board caught `node::SyncProcessRunner::Spawn` under the
    // request handler in 4258 of 4262 main-thread samples, and a synchronous
    // spawn cannot yield — the event loop serves nothing while one runs, so a
    // static file timed out at 15 s beside it.
    //
    // A latency threshold would not catch its return: contention flatters and
    // spoils a number, while the call either is `execFileSync` or is not.
    //
    // `agent-log.ts` IS NOT HERE, and its absence is the measurement rather
    // than an oversight. It keeps one synchronous read for the write routes
    // that cannot await — 27 call sites across ten modules — and the read path
    // never reaches it, because `primeWorktreeRoot` fills the cache through the
    // port before anything serves. Pinning it would pin the migration
    // `production-calls-the-domain-one-rule-at-a-time` owns.
    const migrated = new Set(['fleet.ts', 'server-info.ts']);
    const offenders = sources.filter(
      (s) => migrated.has(s.file) && /execFileSync/.test(s.code),
    );
    expect(offenders.map((s) => s.file)).toEqual([]);
  });
});
