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
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(here, '../../src/server');

/**
 * Comments are stripped before matching. The whole point of this file is to
 * find CALLS, and `board.ts` names `ls-remote` in prose precisely to record why
 * it is not used — a check that fired on the explanation would push the next
 * author to delete the reasoning in order to go green.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const sources = fs
  .readdirSync(SERVER_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({
    file: f,
    text: fs.readFileSync(path.join(SERVER_DIR, f), 'utf8'),
    code: stripComments(fs.readFileSync(path.join(SERVER_DIR, f), 'utf8')),
  }));

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
    const board = sources.find((s) => s.file === 'board.ts');
    expect(board).toBeTruthy();
    expect(board!.code).toMatch(/'for-each-ref'/);
    expect(board!.code).toMatch(/refs\/remotes\/origin\//);
  });

  it('reads plan content with `git show` against a local ref', () => {
    const board = sources.find((s) => s.file === 'board.ts');
    expect(board!.code).toMatch(/'show'/);
  });

  it('reads the served branch ONLY in server-info.ts, never on a request path', () => {
    // The branch the header names is a startup fact — the process serves one
    // worktree for its whole life. `serverInfo()` runs on every /api/board
    // response, so the read is memoised behind a null sentinel in
    // `server-info.ts` and the fork fires once. This pins that by CONSTRUCTION:
    // `--show-current` appears in exactly that file and nowhere else in the
    // server. If it turned up in `index.ts` (the request handler) or `board.ts`
    // (the per-request walker), the branch would be re-forked per poll — the
    // very cost `no-network` exists to keep off this path.
    const offenders = sources.filter(
      (s) => s.file !== 'server-info.ts' && /--show-current/.test(s.code),
    );
    expect(offenders.map((s) => s.file)).toEqual([]);
    // The positive half: not merely "absent elsewhere", but present where it
    // belongs — deleting the read would pass the negative check too.
    const info = sources.find((s) => s.file === 'server-info.ts');
    expect(info!.code).toMatch(/--show-current/);
  });
});
