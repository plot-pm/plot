// A test server's `kill()` ends the host scripts it runs, and each script
// cleans up after itself before the fixture tree goes.
//
// A board request starts the server's PR refresh, which runs the real
// `plot-host.sh pr-list`. A `gh` stub on PATH holds the call for 2 s, so
// `kill()` lands while the script, its `pr_list_call` subshell and the `gh`
// wrapper's subshell are all alive. Two defects of `kill()` show here (#1205):
// a member signalled twice dies inside its `plot-tmp.sh` trap and leaves
// `plot-reg.*` and `plot-host-*` in TMPDIR, and a member the signals miss
// appends to `PLOT_BUDGET_HOME` after the box is removed, which recreates it.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, fetchBoard, makeRepo, rmTree } from './helpers.mjs';

/** How long the `gh` stub holds a call, and so how long a missed writer runs on. */
const GH_HOLD_MS = 2_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once `check()` holds, or rejects after `ms`. */
const until = async (check, ms, what) => {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}`);
};

/** A directory holding a `gh` that answers like an unauthenticated CLI, late. */
const slowGh = () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-kill-bin-'));
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash\nsleep ${GH_HOLD_MS / 1000}\necho "gh: not logged in" >&2\nexit 4\n`,
    { mode: 0o755 },
  );
  return bin;
};

/** The entries `plot-tmp.sh` creates for a host script, still in `dir`. */
const hostEntries = (dir) =>
  fs.readdirSync(dir).filter((name) => name.startsWith('plot-reg.') || name.startsWith('plot-host-'));

describe("a test server's kill() ends its host scripts cleanly", () => {
  const made = [];
  after(() => {
    for (const dir of made) rmTree(dir);
  });

  for (const round of [1, 2, 3, 4]) {
    it(`round ${round}: no plot-reg.* or plot-host-* entry is left, and the box stays gone`, async () => {
      const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-kill-tmp-'));
      const bin = slowGh();
      const repo = makeRepo();
      made.push(tmpdir, bin, repo);
      execFileSync('git', ['init', '-q', repo]);
      const box = path.dirname(repo);
      const server = await startServer(repo, {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        TMPDIR: tmpdir,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GH_CONFIG_DIR: path.join(repo, 'no-gh-config'),
        PLOT_HOST: 'github',
        PLOT_BUDGET_HOME: path.join(repo, '.budget'),
        PLOT_BUDGET_ACCOUNT: '',
      });
      try {
        // A request is what starts the PR refresh.
        await fetchBoard(server.port);
        await until(
          () => fs.readdirSync(tmpdir).some((name) => name.startsWith('plot-host-prlist-err.')),
          15_000,
          'a pr-list call in flight',
        );
      } finally {
        server.kill();
      }
      assert.deepEqual(hostEntries(tmpdir), [], 'every killed host script removed its own temp entries');

      rmTree(repo);
      await sleep(GH_HOLD_MS + 500);
      assert.equal(fs.existsSync(box), false, 'nothing the server started wrote into the box after it was removed');
    });
  }
});
