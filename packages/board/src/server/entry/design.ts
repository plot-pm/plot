// THROUGH THE NARROW PATHS, as `verify.ts` does, so the bundle carries the
// adapters and rules this command uses and no more.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { refsRemoteGit } from '@plot-pm/domain/adapters/refs/refs-remote-git';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { runProcess } from '@plot-pm/domain/adapters/run-script';
import { claimTip, type ClaimAnswer } from '@plot-pm/domain/rules/claim';
import type { Host, PortResult, Refs, Trees } from '@plot-pm/domain';
import type { CommitSubject } from '@plot-pm/domain/ports/refs';
import {
  designBranch,
  designRunGoing,
  readDesignState,
  readDesignStatus,
  designStatusLines,
} from '@plot-pm/fleet/shared/auto-design';
import { pidAlive } from '@plot-pm/fleet/shared/fleet-run';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import type { Printer } from './ladder.js';

/**
 * The `node` entry point of a person's spec-run control.
 *
 * ```
 * plot-design.mjs restart <slug>
 * plot-design.mjs status
 * ```
 *
 * `restart` reads the plan's spec branch (`idea/<slug>-spec`), the design
 * state fleetd wrote and, where needed, the host, then acts by exactly one of
 * eight arms and writes a mark file at
 * `.plot/state/design/restart/<slug>.<epoch-ms>.json` for fleetd's next spec
 * pass to fold. It never writes `auto-design-in-flight.json` itself — one
 * writer, fleetd, owns that file.
 *
 * `status` prints the same block `/plot-fleet --status` prints.
 *
 * Exit 0 on a `start` or `pr-opened` mark and on `status`; 1 on every refusal.
 */

/** What the command line asked for. */
export interface Args {
  command: 'restart' | 'status';
  slug: string;
}

/**
 * Parses argv.
 *
 * @param argv - the arguments after the script name.
 * @returns the parsed request, or the reason it cannot be read.
 */
const parseArgs = (argv: readonly string[]): Args | string => {
  const [command, ...rest] = argv;
  if (command === 'status') return rest.length === 0 ? { command, slug: '' } : 'status takes no argument';
  if (command !== 'restart') return 'need a subcommand: restart <slug> | status';
  const slug = rest[0] ?? '';
  if (slug === '') return 'restart needs a plan slug';
  return { command, slug };
};

/** The ports and paths one invocation needs. */
export interface Context {
  repoRoot: string;
  scriptDir: string;
  refs: Pick<Refs, 'defaultBranch' | 'remoteHead' | 'commitSubjects' | 'remoteSha' | 'showFile'>;
  host: Pick<Host, 'prState' | 'prCreate' | 'prMerged'>;
  trees: Pick<Trees, 'deleteRemoteBranch'>;
}

/** The directory restart marks are written to. */
const restartDir = (repoRoot: string): string => path.join(repoRoot, '.plot', 'state', 'design', 'restart');

/**
 * Writes a restart mark through a temp file and a rename, so fleetd's fold
 * never reads a half-written mark.
 *
 * @param repoRoot - the repository root.
 * @param slug - the plan's slug.
 * @param mark - the mark's fields; fleetd folds `start` as a restart and
 *   `pr-opened` as a success.
 */
const writeMark = (
  repoRoot: string,
  slug: string,
  mark: { kind: 'start' | 'pr-opened'; commit: string; answeredPr?: number },
): void => {
  const dir = restartDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.${Date.now()}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(mark));
  renameSync(tmp, file);
};

/**
 * Reads a spec branch's claim answer, mirroring `auto-design.ts`'s own
 * `specRefOf`: `remoteHead` first, `commitSubjects` only where the ref is
 * `present`.
 *
 * @param ctx - the ports and paths.
 * @param branch - the spec branch.
 * @returns the claim answer.
 */
const specRefOf = async (ctx: Context, branch: string): Promise<ClaimAnswer> => {
  const main = await ctx.refs.defaultBranch();
  const defaultBranchName = main.ok ? main.value : '';
  const ref = await ctx.refs.remoteHead(branch);
  const commits: PortResult<readonly CommitSubject[]> =
    ref.ok && ref.value === 'present'
      ? await ctx.refs.commitSubjects(`origin/${defaultBranchName}..origin/${branch}`)
      : { ok: false, why: 'unaskable' };
  return claimTip(ref.ok ? ref.value : 'unknown', commits);
};

/**
 * Whether a plan has a spec run going on this machine: a record in
 * `auto-design-in-flight.json` whose pid is alive, or not yet recorded inside
 * the start grace.
 *
 * @param repoRoot - the repository root.
 * @param slug - the plan's slug.
 * @returns `true` while a run is going.
 */
const runningHere = (repoRoot: string, slug: string): boolean => {
  const state = readDesignState(repoRoot);
  if (state === null) return false;
  const run = state.running[slug];
  return run !== undefined && designRunGoing(run, pidAlive, Date.now());
};

/**
 * Finds the plan's `Design:` commit, read from its file on the default
 * branch, for the mark's `commit` field — the field `auto-design.ts`'s
 * `specStart` compares against `store.restart[slug]` to tell a pending
 * restart from a stale one.
 *
 * @param ctx - the ports and paths.
 * @param slug - the plan's slug.
 * @returns the commit, or `''` where the plan or the field cannot be read.
 */
const designCommitOf = async (ctx: Context, slug: string): Promise<string> => {
  const main = await ctx.refs.defaultBranch();
  if (!main.ok) return '';
  const ref = `origin/${main.value}`;
  const listed = await runProcess('git', ['-C', ctx.repoRoot, 'ls-tree', '-r', '--name-only', ref]);
  if (listed.code !== 0) return '';
  const planFile = listed.stdout
    .split('\n')
    .find((name) => name.startsWith('docs/plans/') && name.endsWith(`${slug}.md`));
  if (planFile === undefined) return '';
  const text = await ctx.refs.showFile(ref, planFile);
  if (!text.ok) return '';
  return /^Design:\s*(\S+)/m.exec(text.value)?.[1] ?? '';
};

/**
 * Restarts one plan's spec run by exactly one of the eight documented arms,
 * writing the mark fleetd's next spec pass folds.
 *
 * @param ctx - the ports and paths.
 * @param slug - the plan's slug.
 * @param write - where the outcome goes.
 * @param warn - where a refusal goes.
 * @returns the exit code.
 */
const restart = async (ctx: Context, slug: string, write: Printer, warn: Printer): Promise<number> => {
  const branch = designBranch(slug);
  const specRef = await specRefOf(ctx, branch);
  const designCommit = await designCommitOf(ctx, slug);

  if (specRef === 'unknown') {
    warn(`plot-design: refused unknown: the host cannot answer about '${branch}'\n`);
    return 1;
  }

  if (specRef === 'claim-only' || specRef === 'absent') {
    if (runningHere(ctx.repoRoot, slug)) {
      warn(`plot-design: refused running: a spec run of '${slug}' is already going on this machine\n`);
      return 1;
    }
    if (specRef === 'claim-only') {
      const tip = await ctx.refs.remoteSha(branch);
      const deleted = await ctx.trees.deleteRemoteBranch(branch, tip.ok && tip.value !== 'unknown' ? tip.value.sha : '');
      if (!deleted.ok) {
        warn(`plot-design: could not delete '${branch}' — another push may have landed first\n`);
        return 1;
      }
    }
    const closed = await ctx.host.prState(branch);
    const answeredPr = closed.ok && closed.value !== null && closed.value.state !== 'OPEN' ? closed.value.number : undefined;
    writeMark(ctx.repoRoot, slug, { kind: 'start', commit: designCommit, answeredPr });
    write(`restart: start — the next pass with a free slot starts one run of '${slug}'\n`);
    return 0;
  }

  // specRef === 'work'
  if (runningHere(ctx.repoRoot, slug)) {
    warn(`plot-design: refused running: a spec run of '${slug}' is already going on this machine\n`);
    return 1;
  }
  const pr = await ctx.host.prState(branch);
  if (!pr.ok) {
    warn(`plot-design: refused unknown: the host cannot answer about '${branch}'\n`);
    return 1;
  }
  if (pr.value !== null && pr.value.state === 'OPEN') {
    warn(`plot-design: refused open-pr: ${pr.value.repo}#${pr.value.number} is already open\n`);
    return 1;
  }
  if (pr.value !== null && pr.value.state === 'MERGED') {
    warn(`plot-design: refused merged: '${branch}' already merged — the plan's text on the default branch decides from here\n`);
    return 1;
  }

  const main = await ctx.refs.defaultBranch();
  const defaultBranchName = main.ok ? main.value : '';
  const text = await ctx.refs.commitSubjects(`origin/${defaultBranchName}..origin/${branch}`);
  const written = text.ok && text.value.length > 0;

  if (pr.value === null && written) {
    const created = await ctx.host.prCreate({
      head: branch,
      title: `${slug}: spec`,
      body: `Spec for ${slug}, written by the fleet.`,
      draft: true,
    });
    if (!created.ok) {
      warn(`plot-design: could not open a pull request for '${branch}'\n`);
      return 1;
    }
    writeMark(ctx.repoRoot, slug, { kind: 'pr-opened', commit: designCommit });
    write(`restart: pr-opened — ${created.value}\n`);
    return 0;
  }

  // pr.value === null && !written, or a CLOSED pr: delete only once not merged.
  const merged = await ctx.host.prMerged(branch);
  if (!merged.ok || merged.value !== 'not-merged') {
    warn(`plot-design: refused merged: '${branch}' cannot be confirmed unmerged — nothing was deleted\n`);
    return 1;
  }
  const tip = await ctx.refs.remoteSha(branch);
  const deleted = await ctx.trees.deleteRemoteBranch(branch, tip.ok && tip.value !== 'unknown' ? tip.value.sha : '');
  if (!deleted.ok) {
    warn(`plot-design: could not delete '${branch}' — another push may have landed first\n`);
    return 1;
  }
  const answeredPr = pr.value !== null ? pr.value.number : undefined;
  writeMark(ctx.repoRoot, slug, { kind: 'start', commit: designCommit, answeredPr });
  write(`restart: start — the next pass with a free slot starts one run of '${slug}'\n`);
  return 0;
};

/**
 * Resolves the repository root from the git common directory.
 *
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @returns the root, or `null` outside a repository.
 */
const resolveRepoRoot = async (cwd: string, scriptDir: string): Promise<string | null> => {
  const common = await runProcess('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  const dir = common.stdout.trim();
  if (common.code === 0 && path.basename(dir) === '.git') return path.dirname(dir);
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  return probe.ok ? probe.value : null;
};

/**
 * Dispatches one subcommand.
 *
 * @param argv - the arguments after the script name.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where output goes.
 * @param warn - where refusals go.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    warn(`plot-design: ${parsed}\n`);
    return 1;
  }
  const repoRoot = await resolveRepoRoot(cwd, scriptDir);
  if (repoRoot === null) {
    warn('plot-design: not a git repository — run this from inside the checkout\n');
    return 1;
  }
  if (parsed.command === 'status') {
    write(designStatusLines(readDesignStatus(repoRoot)));
    return 0;
  }
  const context = { repoRoot, scriptDir };
  const ctx: Context = {
    repoRoot,
    scriptDir,
    // `refsGit` answers `remoteSha` as `unaskable`; `refsRemoteGit` reads it
    // over `git ls-remote` — the real tip `deleteRemoteBranch`'s
    // force-with-lease must pin against, as `auto-design.ts` composes it too.
    refs: { ...refsGit(context), remoteSha: refsRemoteGit(context).remoteSha },
    host: hostShell(context),
    trees: treesGit(context),
  };
  return restart(ctx, parsed.slug, write, warn);
};

// Only when RUN as plot-design.mjs, never when imported — bundles share
// `import.meta.url`, so the basename tells this one from a bundle that includes it.
if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'plot-design.mjs' &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
