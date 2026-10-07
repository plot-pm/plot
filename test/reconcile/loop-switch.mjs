// THE ONE SWITCH THAT DECIDES WHICH LOOP A TEST RUN DRIVES.
//
// `PLOT_TEST_WORKER_LOOP` is read here and nowhere else. A test helper that
// writes a sandbox repository's `## Plot Config` appends the line this returns,
// so `plot-worker-loop.sh` reads `Worker loop` from the fixture's own config
// the way an adopting repository's would. `plot-config.sh` has no override:
// the switch lives in the test helpers only, and slice 6 removes it with the key.
//
// AN UNSET SWITCH IS `shell`, AND THE LINE IS WRITTEN. `validate` runs these
// files unset and `loop-js` runs them with `js`, so the shell body keeps its
// coverage until slice 6. Since slice 5 an absent key runs the JS loop, so an
// unset switch writes `- **Worker loop:** shell` rather than leaving the key out.
//
// Not named `*.test.mjs`, so `node --test test/reconcile/*.test.mjs` does not
// run it as a test file.

const VALUES = ['js', 'shell'];

/**
 * The loop this run drives.
 *
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @returns {'js' | 'shell'} the value; `shell` where the switch is unset or empty.
 * @throws {Error} on a value that names neither loop.
 */
export const testWorkerLoop = (env = process.env) => {
  const value = env.PLOT_TEST_WORKER_LOOP || 'shell';
  if (!VALUES.includes(value)) {
    throw new Error(`PLOT_TEST_WORKER_LOOP must be one of ${VALUES.join(', ')}, got '${value}'`);
  }
  return value;
};

/**
 * The `Worker loop` line a sandbox's `## Plot Config` carries.
 *
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @returns {string} a full config line ending in a newline, naming the loop {@link testWorkerLoop} returns.
 */
export const workerLoopLine = (env = process.env) => `- **Worker loop:** ${testWorkerLoop(env)}\n`;

/**
 * Keeps a desk's own files out of `git status` on the JS loop.
 *
 * The JS loop refuses to take up a desk that holds untracked files, and a
 * fixture's `.plot/` and `.plot-worker.*` are untracked. The shell loop reads
 * the same files as the desk's holdings, and several tests assert that it
 * names them, so only the JS run excludes them.
 *
 * @param {string} work - the clone whose common git directory takes the entry.
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @param {(file: string, text: string) => void} append - writes the entry, `fs.appendFileSync`.
 */
export const excludeDeskFilesOnJs = (work, append, env = process.env) => {
  if (testWorkerLoop(env) !== 'js') return;
  append(`${work}/.git/info/exclude`, '.plot/\n.plot-worker.*\n');
};
