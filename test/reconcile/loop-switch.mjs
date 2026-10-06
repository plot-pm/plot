// THE ONE SWITCH THAT DECIDES WHICH LOOP A TEST RUN DRIVES.
//
// `PLOT_TEST_WORKER_LOOP` is read here and nowhere else. A test helper that
// writes a sandbox repository's `## Plot Config` appends the line this returns,
// so `plot-worker-loop.sh` reads `Worker loop` from the fixture's own config
// the way an adopting repository's would. `plot-config.sh` has no override:
// the switch lives in the test helpers only, and slice 6 removes it with the key.
//
// Not named `*.test.mjs`, so `node --test test/reconcile/*.test.mjs` does not
// run it as a test file.

const VALUES = ['js', 'shell'];

/**
 * The loop this run drives.
 *
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @returns {'js' | 'shell' | ''} the value; `''` where the run leaves the choice to the key's default.
 * @throws {Error} on a value that names neither loop.
 */
export const testWorkerLoop = (env = process.env) => {
  const value = env.PLOT_TEST_WORKER_LOOP ?? '';
  if (value !== '' && !VALUES.includes(value)) {
    throw new Error(`PLOT_TEST_WORKER_LOOP must be one of ${VALUES.join(', ')}, got '${value}'`);
  }
  return value;
};

/**
 * The `Worker loop` line a sandbox's `## Plot Config` carries.
 *
 * @param {NodeJS.ProcessEnv} [env] - the environment to read.
 * @returns {string} a full config line ending in a newline, or `''` where the switch is unset.
 */
export const workerLoopLine = (env = process.env) => {
  const value = testWorkerLoop(env);
  return value === '' ? '' : `- **Worker loop:** ${value}\n`;
};

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
