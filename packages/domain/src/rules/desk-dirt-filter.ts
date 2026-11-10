/**
 * The desk's own records: `.plot-worker.pid`, `.exit`, `.log` and every other
 * `.plot-worker.` file, at any depth. `PLOT_WORKER_RECORD` in `plot-worker-state.sh`.
 */
export const WORKER_RECORD = /(^|\/)\.plot-worker\./;

/** What an editor drops beside real work. `PLOT_EDITOR_LEFTOVER` in `plot-worker-state.sh`. */
export const EDITOR_LEFTOVER = /\.(tmp[0-9]*|swp|orig|rej|bak)$/;

/** The scratch directories a tool creates and nobody commits. `PLOT_TOOL_SCRATCH` in `plot-worker-state.sh`. */
export const TOOL_SCRATCH = /(^|\/)\.(playwright-mcp|plot\/agents|plot\/state|omc\/state)(\/|$)/;

/** The one whole porcelain line the filter drops: the loop's untracked correction file at the desk root. */
const CORRECTION_LINE = '?? PLOT-CORRECTION.md';

/** One `shipped… = path.join(…)` declaration in `packages/board/build.mjs`, on one line. */
const SHIPPED_DECLARATION = /shipped[A-Za-z]* = path\.join\([^)]*'[^']*'\)/g;

/** The repository-relative path inside a declaration; the last `'../../…'` argument wins. */
const SHIPPED_PATH = /^.*'\.\.\/\.\.\/([^']*)'.*$/;

/**
 * Reads the generated bundle paths a board build file declares, as
 * `plot-desk-dirt.sh`'s `bundle_paths` reads them.
 *
 * Each `shipped<Name> = path.join(…, '../../<path>')` declaration on a single
 * line yields `<path>`. A declaration that names no `'../../'` argument yields
 * its whole text, which matches no porcelain path. A declaration that spans
 * lines yields nothing.
 *
 * @param buildText - the text of a desk's own `packages/board/build.mjs`.
 * @returns the declared paths, each once, in declaration order.
 */
export const bundlePathsOf = (buildText: string): string[] => {
  const paths = new Set<string>();
  for (const line of buildText.split('\n')) {
    for (const [declaration] of line.matchAll(SHIPPED_DECLARATION)) {
      paths.add(SHIPPED_PATH.exec(declaration)?.[1] ?? declaration);
    }
  }
  return [...paths];
};

/**
 * Keeps the uncommitted paths of a desk that count as work, as
 * `plot-worker-state.sh`'s `plot_worker_dirty_filter` keeps them.
 *
 * Drops, in order: a porcelain line whose path is one of `bundlePaths`; the
 * whole line `?? PLOT-CORRECTION.md`; and every path that {@link WORKER_RECORD},
 * {@link EDITOR_LEFTOVER} or {@link TOOL_SCRATCH} matches. A rename keeps its
 * `old -> new` text, and the patterns read that whole text. A quoted path keeps
 * its quotes.
 *
 * @param porcelain - `git status --porcelain` output, one `XY path` line each.
 * @param bundlePaths - the generated bundle paths to excuse; empty excuses none.
 * @returns the remaining paths without their status codes, in porcelain order.
 */
export const deskDirtFilter = (porcelain: string, bundlePaths: readonly string[]): string[] => {
  const bundles = new Set(bundlePaths);
  return porcelain
    .split('\n')
    .filter((line) => line !== '' && line !== CORRECTION_LINE && !bundles.has(line.slice(3)))
    .map((line) => line.slice(3))
    .filter((path) => path !== '' && !WORKER_RECORD.test(path) && !EDITOR_LEFTOVER.test(path) && !TOOL_SCRATCH.test(path));
};
