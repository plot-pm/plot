// HOW the board reads the plan estate — asserted by counting PROCESS SPAWNS.
//
// The shape is the design, not an implementation detail of it. Each `git`
// invocation costs ~55 ms of process spawn regardless of how little work it
// does — the constraint `collectBranchPlans` already caches on tip SHAs to
// avoid — so a read that spawns one process per plan pays that 151 times on a
// path the client polls every few seconds. Measured against this repo's estate
// on 2026-08-27: ~1.5 s for a per-file loop against 0.011 s for one
// `git cat-file --batch`. 136× apart.
//
// A per-file implementation would satisfy every other assertion in
// `plan-source.test.mjs` and leave the board SLOWER THAN THE DEFECT IT FIXES.
// Nothing else here would catch it, which is why these two items exist.
//
// COUNTED, NOT TIMED, and deliberately: a duration assertion is flaky on a
// loaded machine — this suite runs sixteen files in parallel — while the spawn
// count is the FACT THAT PRODUCES the duration. It fails for the right reason
// and it fails the same way every time.
//
// The counting works by putting a shim `git` and a shim `bash` ahead of the
// real ones on PATH. Each shim appends one line to a log and then `exec`s the
// real binary, so the artifact under test runs unmodified and every spawn it
// makes is recorded.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, fetchBoard, rmTree } from './helpers.mjs';

const HOW_MANY_PLANS = 40;

function planBody(i) {
  return `# Plan number ${i}

## Status

- **Phase:** Approved
- **Type:** feature

## Changelog

One of many plans, to make a per-file read visibly different from a batch one.
`;
}

/** Absolute path of a real binary, resolved BEFORE the shims shadow it. */
function realBinary(name) {
  return execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim();
}

/**
 * A shim directory holding `git` and `bash` that log every invocation.
 *
 * `exec "$REAL" "$@"` — so the shim adds a line to the log and then BECOMES the
 * real command, arguments, stdin, stdout and exit status intact. The board
 * cannot tell the difference, which is what makes the count a measurement of
 * the shipped code rather than of a test double.
 */
function makeShims(dir, log) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['git', 'bash']) {
    const real = realBinary(name);
    const shim = path.join(dir, name);
    fs.writeFileSync(
      shim,
      `#!/bin/sh\nprintf '%s %s\\n' ${name} "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(real)} "$@"\n`,
      'utf8',
    );
    fs.chmodSync(shim, 0o755);
  }
}

const linesIn = (log, pattern) =>
  fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter((l) => pattern.test(l));

describe('the read shape', () => {
  let tmp;
  let boardDir;
  let log;
  let server;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-read-shape-'));
    const bare = path.join(tmp, 'origin.git');
    const author = path.join(tmp, 'author');
    boardDir = path.join(tmp, 'board');
    log = path.join(tmp, 'spawns.log');
    fs.writeFileSync(log, '', 'utf8');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    execFileSync('git', ['clone', '-q', bare, author], { stdio: ['ignore', 'pipe', 'ignore'] });
    fs.mkdirSync(path.join(author, 'docs/plans'), { recursive: true });
    for (let i = 0; i < HOW_MANY_PLANS; i++) {
      fs.writeFileSync(
        path.join(author, `docs/plans/2026-01-${String(i + 1).padStart(2, '0')}-plan-${i}.md`),
        planBody(i),
        'utf8',
      );
    }
    const ga = (...args) =>
      execFileSync('git', args, { cwd: author, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    ga('add', '-A');
    ga('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'plans');
    ga('push', '-q', 'origin', 'HEAD:main');
    execFileSync('git', ['clone', '-q', bare, boardDir], { stdio: ['ignore', 'pipe', 'ignore'] });

    const shimDir = path.join(tmp, 'shims');
    makeShims(shimDir, log);
    server = await startServer(boardDir, { PATH: `${shimDir}${path.delimiter}${process.env.PATH}` });
    // One board build, and the log is read afterwards. Truncated first so the
    // server's own startup does not count against the request.
    fs.writeFileSync(log, '', 'utf8');
    const board = await fetchBoard(server.port);
    assert.equal(
      board.columns.flatMap((c) => c.cards).length,
      HOW_MANY_PLANS,
      'every plan must reach the board, or the counts below describe nothing',
    );
  });

  after(async () => {
    await server?.kill();
    rmTree(tmp);
  });

  it('reads every plan blob in ONE git process', () => {
    // Item 5. The whole estate arrives in a single `cat-file --batch`; the
    // per-file shape would be one `cat-file`/`show` per plan.
    const batches = linesIn(log, /^git .*cat-file --batch/);
    assert.equal(batches.length, 1, `expected exactly one batch read, got ${batches.length}`);
    const perFile = linesIn(log, /^git .*(cat-file (-p|blob)|show) /);
    assert.equal(
      perFile.length,
      0,
      `no per-file blob read may remain, found ${perFile.length}:\n${perFile.join('\n')}`,
    );
  });

  it('spawns plot-plan-meta.sh ONCE for the whole estate', () => {
    // Item 12. `readPlanMeta` takes an ARRAY and its docstring says so — one
    // `bash` spawn for every plan, with a 64 MB buffer already sized for it.
    // Reading the ref correctly and then parsing per file would be ~8 s on this
    // repo's estate and would undo the batch read entirely, and no other
    // assertion in this branch would notice.
    const parses = linesIn(log, /plot-plan-meta\.sh/);
    assert.equal(parses.length, 1, `expected one parser spawn, got ${parses.length}`);
  });

  it('keeps the total git spawn count independent of how many plans there are', () => {
    // The property the two counts above exist to protect, stated directly: a
    // board build must not cost more processes because a repo has more plans.
    // Well under the plan count, with room for the fixed reads (config, refs,
    // worktrees) that legitimately happen once per build.
    const gitSpawns = linesIn(log, /^git /);
    assert.ok(
      gitSpawns.length < HOW_MANY_PLANS,
      `git spawns (${gitSpawns.length}) must not scale with plans (${HOW_MANY_PLANS}):\n${gitSpawns.join('\n')}`,
    );
  });

  it('adds no git fetch to the board', () => {
    // Item 6. The scan already fetches every pulse, so `origin/main` in the
    // board's own repository is already current — the stale bytes were never
    // stale because the data was far away. A fetch here would also make a poll
    // loop depend on the git host being reachable.
    const fetches = linesIn(log, /^git .*\b(fetch|ls-remote|pull)\b/);
    assert.deepEqual(fetches, [], 'the board must reach no network');
  });
});
