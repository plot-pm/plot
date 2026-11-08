import { resolve } from 'node:path';

import { runProcess, type RunOptions, type ScriptRun } from '../run-script.js';

/** Starts one process and reports how it ended. {@link runProcess} in production. */
export type ProcessRunner = (command: string, args: readonly string[], options?: RunOptions) => Promise<ScriptRun>;

/**
 * Answers that do not change while a process runs, each read with one process
 * and then held: the repository's top level, its common git directory, and
 * the host backend `plot-host.sh` names.
 *
 * Every method answers the {@link ScriptRun} the process left, so a caller
 * reads it exactly as it read its own `runProcess` call. A held answer is the
 * same object on every call.
 *
 * A read that fails is not held, and the next call starts the process again.
 * Concurrent first calls for one key share one process.
 */
export interface FixedAnswers {
  /**
   * `git rev-parse --git-common-dir` in `cwd`, as git printed it: relative in
   * a main checkout, absolute in a linked worktree.
   *
   * @param cwd - where to ask; the process's own directory when omitted.
   */
  commonDir: (cwd?: string) => Promise<ScriptRun>;
  /**
   * `git rev-parse --show-toplevel` in `cwd`.
   *
   * @param cwd - where to ask; the process's own directory when omitted.
   */
  toplevel: (cwd?: string) => Promise<ScriptRun>;
  /**
   * `git -C <path> rev-parse --path-format=absolute --git-common-dir`, run in `cwd`.
   *
   * @param path - the checkout to ask about.
   * @param cwd - where the process runs.
   */
  absoluteCommonDir: (path: string, cwd: string) => Promise<ScriptRun>;
  /**
   * `git rev-parse --absolute-git-dir --path-format=absolute --git-common-dir`
   * in `cwd`: two lines, the checkout's own git directory and the common one.
   *
   * @param cwd - where to ask.
   */
  gitDirs: (cwd: string) => Promise<ScriptRun>;
  /**
   * `bash <hostScript> backend` in `cwd`. Exit 0 and exit 4 (the script cannot
   * drive the host it names) are held; any other exit is asked again. The key
   * includes `PLOT_HOST` from the process environment, which the script reads
   * before its config.
   *
   * @param hostScript - the absolute path of `plot-host.sh`.
   * @param cwd - where the script runs.
   */
  backend: (hostScript: string, cwd: string) => Promise<ScriptRun>;
  /**
   * The environment a Plot script started in `repoRoot` reads instead of
   * asking git: `PLOT_REPO_ROOT` (the top level) and `PLOT_GIT_COMMON_DIR`
   * (the common git dir, absolute). Reads both answers on first use. A key
   * whose answer failed is absent.
   *
   * @param repoRoot - the checkout the script runs in.
   */
  scriptEnv: (repoRoot: string) => Promise<Record<string, string>>;
  /**
   * {@link FixedAnswers.scriptEnv} from the answers already held, for a
   * synchronous caller. Starts no process; a key not yet read is absent.
   *
   * @param repoRoot - the checkout the script runs in.
   */
  heldScriptEnv: (repoRoot: string) => Record<string, string>;
}

/** The two variables a Plot script reads before it asks git for the same answer. */
export const FIXED_ENV_KEYS = ['PLOT_REPO_ROOT', 'PLOT_GIT_COMMON_DIR'] as const;

/** Exit 4 is `plot-host.sh`'s "cannot drive" answer, permanent for a configuration. */
const EXIT_CANNOT_DRIVE = 4;

const gitAnswered = (run: ScriptRun): boolean => run.code === 0 && run.stdout.trim() !== '';

const backendAnswered = (run: ScriptRun): boolean =>
  (run.code === 0 && run.stdout.trim() !== '') || run.code === EXIT_CANNOT_DRIVE;

/**
 * Builds an empty set of held answers over a runner.
 *
 * A new instance holds nothing and asks again. Production uses
 * {@link processAnswers}; a test builds its own instance with a counting
 * runner.
 *
 * @param run - starts the processes; {@link runProcess} by default.
 * @returns the answers, read on first use.
 */
export const fixedAnswers = (run: ProcessRunner = runProcess): FixedAnswers => {
  const held = new Map<string, Promise<ScriptRun>>();
  const settled = new Map<string, ScriptRun>();

  const once = (key: string, holds: (r: ScriptRun) => boolean, start: () => Promise<ScriptRun>): Promise<ScriptRun> => {
    const known = held.get(key);
    if (known !== undefined) return known;
    const asked = start().then((answer) => {
      if (holds(answer)) settled.set(key, answer);
      else if (held.get(key) === asked) held.delete(key);
      return answer;
    });
    held.set(key, asked);
    return asked;
  };

  const here = (cwd?: string): string => resolve(cwd ?? process.cwd());

  const commonDir = (cwd?: string): Promise<ScriptRun> =>
    once(`common\0${here(cwd)}`, gitAnswered, () => run('git', ['rev-parse', '--git-common-dir'], { cwd }));
  const toplevel = (cwd?: string): Promise<ScriptRun> =>
    once(`top\0${here(cwd)}`, gitAnswered, () => run('git', ['rev-parse', '--show-toplevel'], { cwd }));

  const envOf = (repoRoot: string, top: ScriptRun | undefined, common: ScriptRun | undefined): Record<string, string> => ({
    ...(top !== undefined && gitAnswered(top) ? { PLOT_REPO_ROOT: top.stdout.trim() } : {}),
    ...(common !== undefined && gitAnswered(common) ? { PLOT_GIT_COMMON_DIR: resolve(repoRoot, common.stdout.trim()) } : {}),
  });

  return {
    commonDir,
    toplevel,
    scriptEnv: async (repoRoot) => {
      const [top, common] = await Promise.all([toplevel(repoRoot), commonDir(repoRoot)]);
      return envOf(repoRoot, top, common);
    },
    heldScriptEnv: (repoRoot) =>
      envOf(repoRoot, settled.get(`top\0${here(repoRoot)}`), settled.get(`common\0${here(repoRoot)}`)),
    absoluteCommonDir: (path, cwd) =>
      once(`abs-common\0${resolve(cwd, path)}`, gitAnswered, () =>
        run('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }),
      ),
    gitDirs: (cwd) =>
      once(`dirs\0${here(cwd)}`, gitAnswered, () =>
        run('git', ['rev-parse', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir'], { cwd }),
      ),
    backend: (hostScript, cwd) =>
      once(`backend\0${hostScript}\0${here(cwd)}\0${process.env['PLOT_HOST'] ?? ''}`, backendAnswered, () =>
        run('bash', [hostScript, 'backend'], { cwd }),
      ),
  };
};

/**
 * The answers this process holds. Adapters read through it unless a caller
 * hands them another instance.
 */
export const processAnswers: FixedAnswers = fixedAnswers();

/**
 * Adds the fixed variables to the environment a script is started with.
 *
 * A key the caller gave in `given` wins, and so does a non-empty value the
 * process already carries in `base`: neither is overwritten.
 *
 * @param fixed - the variables, from {@link FixedAnswers.scriptEnv}.
 * @param given - the caller's own extra environment, if any.
 * @param base - the environment the child inherits; `process.env` by default.
 * @returns the extra environment to start the script with.
 */
export const withFixedEnv = (
  fixed: Readonly<Record<string, string>>,
  given?: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> => {
  const added: Record<string, string> = {};
  for (const key of FIXED_ENV_KEYS) {
    const value = fixed[key];
    if (value === undefined || (given !== undefined && key in given)) continue;
    const inherited = base[key];
    if (inherited !== undefined && inherited !== '') continue;
    added[key] = value;
  }
  return { ...added, ...given };
};

/**
 * Builds a runner that starts each process in `repoRoot` with
 * {@link withFixedEnv} added, for the adapters that start Plot scripts.
 *
 * @param repoRoot - the checkout the scripts run in.
 * @param answers - the held answers; this process's own by default.
 * @param run - starts the process; {@link runProcess} by default.
 * @returns a runner with `runProcess`'s signature.
 */
export const scriptRunner =
  (repoRoot: string, answers: FixedAnswers = processAnswers, run: ProcessRunner = runProcess): ProcessRunner =>
  async (command, args, options = {}) =>
    run(command, args, { ...options, env: withFixedEnv(await answers.scriptEnv(repoRoot), options.env) });
