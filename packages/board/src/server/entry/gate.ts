import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostPinsMerges } from './host-pin.js';
import { MANAGED_PROCESS_MARKERS, controllerInvocation } from '@plot-pm/domain/rules/ci-suite';
import {
  carriesSpikeFlag,
  controllerRefusal,
  mayRunController,
  pinUnavailable,
  UNPINNABLE_NOTE,
  unpinnedMergeRefusal,
  unpinnedMerges,
  withoutQuotedHeredocs,
} from '@plot-pm/domain/rules/controller-gate';

/**
 * The `node` entry point `plot-gates.sh` launches: one PreToolUse hook that
 * answers every Plot gate for a Bash call.
 *
 * ```
 * echo '{"tool_input":{"command":"git commit -m x"}}' | plot-gate.mjs --all
 * echo '{"tool_input":{"command":"git commit -m x"}}' | plot-gate.mjs state controller
 * plot-gate.mjs --list
 * ```
 *
 * **Exit 2 refuses and stderr reaches the agent; any other exit allows.** That
 * is the hook contract, and it does not change here. Only `tool_input.command`
 * is read from the hook JSON, once.
 *
 * **One start replaces five.** Measured 2026-10-10 on `c9d63311d` for `ls -la`
 * (no commit, no gated script): the five `plot-*-gate.sh` hooks cost 70.5 ms
 * wall and 59 ms CPU summed; one `bash` → `exec node` launcher over a small
 * bundle costs 33.9 ms wall and 28 ms CPU. Five launchers would cost
 * 140–310 ms CPU, so the entry answers every gate in one process.
 *
 * **Ask first, load later.** A gate declares `wants(command)`, a pure
 * predicate, and `ask(command)`, which is where its adapters are imported
 * (`await import(...)`). A call no gate wants never loads an adapter. Gates
 * register by adding a row to `GATES`.
 *
 * **One gate's failure never decides another's answer.** Each gate runs inside
 * its own `try`. A gate that throws in `wants` or `ask` is named on stderr and
 * answers by its own `onError`: `'allow'` lets the call through and says the
 * gate went UNVERIFIED; `'refuse'` exits 2 and names the gate (#1245).
 */

/** One gate: when it applies and how it answers. */
export interface Gate {
  /** The name given on the command line, e.g. `state` for `plot-state-gate.sh`. */
  readonly name: string;
  /** Pure: whether this gate needs any reading for `command`. */
  readonly wants: (command: string) => boolean;
  /** The refusal text, or `null` to allow. Imports its adapters lazily. */
  readonly ask: (command: string) => Promise<string | null>;
  /** The answer when `wants` or `ask` throws: allow and say so, or refuse. */
  readonly onError: 'allow' | 'refuse';
}

/**
 * `bundle-commit`: refuses a commit that stages a generated board bundle.
 *
 * `wants` is a pure string test — no adapter loads for a command with no
 * `git commit` in it. `ask` reads the repository root and its
 * `packages/board/build.mjs`; a repository with no `build.mjs` builds no
 * bundle, so the gate allows. Otherwise it reads the staged paths and, only
 * when one of them is in the declared set, the merge base against
 * `origin/main` and whether the merge base held each such path. All of it
 * goes to {@link bundleCommitRefusal}.
 */
const bundleCommitGate: Gate = {
  name: 'bundle-commit',
  wants: (command) => command.includes('git commit'),
  ask: async (_command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { shellContext } = await import('@plot-pm/domain/adapters');
    const { bundleCommitPaths, bundleCommitRefusal, shippedPathsOf } = await import(
      '@plot-pm/domain/rules/bundle-commit'
    );

    const refs = refsGit(shellContext(process.cwd()));
    const root = await refs.repoRoot();
    if (!root.ok) return null;

    const buildFile = join(root.value, 'packages/board/build.mjs');
    if (!existsSync(buildFile)) return null;
    const generated = shippedPathsOf(readFileSync(buildFile, 'utf8'));
    if (generated.length === 0) return null;

    const staged = await refs.stagedPaths();
    if (!staged.ok) return null;
    const touched = bundleCommitPaths({ generated, staged: staged.value });
    if (touched.length === 0) return null;

    const mergeBaseResult = await refs.mergeBase('HEAD', 'origin/main');
    const mergeBase = mergeBaseResult.ok ? mergeBaseResult.value : null;

    const existedAtMergeBase: Record<string, boolean> = {};
    if (mergeBase !== null) {
      for (const path of touched) {
        const existed = refs.fileExistsSync(mergeBase, path);
        existedAtMergeBase[path] = existed.ok && existed.value;
      }
    }

    return bundleCommitRefusal({ generated, staged: staged.value, mergeBase, existedAtMergeBase });
  },
  onError: 'allow',
};

/**
 * `brief-name`: refuses a commit that adds or renames a hand-off brief to
 * `.plot/briefs/<prefix>-<slug>.md` when no branch has that path as its
 * `briefPath`.
 *
 * `wants` is a pure string test. `ask` reads; `briefNameRefusal` decides. It
 * reads the `Branch prefixes` config, the index, and — for a `git add` or
 * `git mv` chained in the same command, which runs after this hook — the
 * untracked files that `git add` would stage and the working directory's
 * offset from the repository root. Only for a path `briefNameCandidates`
 * names does it read more: whether `HEAD` holds it, its text, whether its
 * computed path exists, and the branch names. A failed config read throws,
 * which `onError: 'allow'` reports as UNVERIFIED; a failed git read allows.
 */
const briefNameGate: Gate = {
  name: 'brief-name',
  wants: (command) => command.includes('git commit'),
  ask: async (command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { scriptsShell } = await import('@plot-pm/domain/adapters/scripts/scripts-shell');
    const { DEFAULT_BRANCH_PREFIXES, briefNameCandidates, briefNameRefusal, briefPrefixesOf, chainedStagesOf } =
      await import('@plot-pm/domain/rules/brief-name');

    const cwd = process.cwd();
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const refs = refsGit({ repoRoot: cwd, scriptDir });

    const root = await refs.repoRoot();
    if (!root.ok) return null;
    const config = await scriptsShell({ repoRoot: cwd, scriptDir }).config('Branch prefixes', DEFAULT_BRANCH_PREFIXES);
    if (!config.ok) throw new Error('the Branch prefixes config read failed');
    const prefixes = briefPrefixesOf(config.value);

    const staged = await refs.stagedPaths();
    const showPrefix = await refs.showPrefix();
    if (!staged.ok || !showPrefix.ok) return null;

    const chained = chainedStagesOf(command, showPrefix.value);
    const untracked: string[] = [];
    for (const pathspec of chained.adds) {
      const paths = await refs.untrackedPaths(pathspec);
      if (paths.ok) untracked.push(...paths.value);
    }
    const landed = { staged: staged.value, untracked, moves: chained.moves, prefixes };
    const candidates = briefNameCandidates(landed);
    if (candidates.length === 0) return null;

    const inHead = new Set<string>();
    const texts = new Map<string, string>();
    const present = new Set<string>();
    for (const { path, want } of candidates) {
      const held = refs.fileExistsSync('HEAD', path);
      if (held.ok && held.value) inHead.add(path);
      try {
        texts.set(path, readFileSync(join(root.value, path), 'utf8'));
      } catch {
        // No text in the working tree reads as no branch named.
      }
      if (existsSync(join(root.value, want))) present.add(want);
    }
    const branches = new Set<string>();
    for (const remote of [false, true]) {
      const names = await refs.listBranches(remote);
      if (names.ok) for (const name of names.value) branches.add(name);
    }

    return briefNameRefusal({ ...landed, inHead, branches, texts, present });
  },
  onError: 'allow',
};

/**
 * `state`: refuses a commit that changes a `State:` line in a plan or sprint
 * file's `## Status` section unless a receipt from the script that owns the
 * write clears it.
 *
 * `wants` is a pure string test. `ask` reads the index (deletions and modes
 * included), the working tree's changes and the show-prefix; `effectivePaths`
 * decides which paths the commit carries and, for each, whether it takes the
 * staged text or the working copy (`-a`, `--all` or a chained `git add`, which
 * runs after this hook). For each path under the plan or sprint directory, and
 * for the old path of each rename git paired, it reads `HEAD`'s version and
 * the version the commit takes, each with whether it is a symbolic link (the
 * mode git holds, or `lstat` for a working copy, which is never followed);
 * `stateTransitionsOf` finds the transitions, and only then is a path's
 * receipt spent. A failed config read
 * throws, which `onError: 'allow'` reports as UNVERIFIED; an unreadable `HEAD`
 * or index allows. A transition seen with no clearing receipt refuses.
 */
const stateGate: Gate = {
  name: 'state',
  wants: (command) => command.includes('git commit'),
  ask: async (command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { scriptsShell } = await import('@plot-pm/domain/adapters/scripts/scripts-shell');
    const { stateReceiptsFile } = await import('@plot-pm/domain/adapters/state-receipts/state-receipts-file');
    const { SYMLINK_MODE, effectivePaths, lifecycleKindOf, receiptOf, stateTransitionRefusal, stateTransitionsOf } = await import(
      '@plot-pm/domain/rules/state-transition'
    );
    const { gitBlobOid } = await import('./ladder.js');

    const cwd = process.cwd();
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const refs = refsGit({ repoRoot: cwd, scriptDir });
    const root = await refs.repoRoot();
    if (!root.ok) return null;

    const scripts = scriptsShell({ repoRoot: cwd, scriptDir });
    const planDir = await scripts.config('Plan directory', 'docs/plans/');
    const sprintDir = await scripts.config('Sprint directory', 'docs/sprints/');
    if (!planDir.ok || !sprintDir.ok) throw new Error('the Plan directory or Sprint directory config read failed');

    const staged = await refs.stagedEntries();
    const workingChanges = await refs.workingChanges();
    const showPrefix = await refs.showPrefix();
    if (!staged.ok) return null;
    const carried = effectivePaths(
      {
        staged: staged.value.map((entry) => entry.path),
        workingChanges: workingChanges.ok ? workingChanges.value : [],
        showPrefix: showPrefix.ok ? showPrefix.value : '',
      },
      command,
    );

    // `ls-tree` reads its pathspec against the cwd, so `HEAD`'s mode is read
    // from the repository root.
    const atRoot = refsGit({ repoRoot: root.value, scriptDir });
    const headOf = async (path: string) => {
      const text = await refs.showFile('HEAD', path);
      if (!text.ok) return null;
      const blobs = await atRoot.listBlobs('HEAD', path);
      const link = blobs.ok && blobs.value.some((blob) => blob.path === path && blob.mode === SYMLINK_MODE);
      return { text: text.value, link };
    };
    const indexModes = new Map(staged.value.map((entry) => [entry.path, entry.indexMode]));
    const readings = [];
    for (const { path, carries } of carried) {
      const kind = lifecycleKindOf(path, planDir.value.trim(), sprintDir.value.trim());
      if (kind === null) continue;
      let committed = null;
      if (carries === 'working') {
        try {
          const full = join(root.value, path);
          committed = lstatSync(full).isSymbolicLink()
            ? { text: readlinkSync(full), link: true }
            : { text: readFileSync(full, 'utf8'), link: false };
        } catch {
          // No working copy: the commit carries a deletion.
        }
      } else {
        const index = await refs.showFile(':0', path);
        if (index.ok) committed = { text: index.value, link: indexModes.get(path) === SYMLINK_MODE };
      }
      readings.push({ path, kind, head: await headOf(path), committed });
    }
    // Git pairs a staged rename into one entry under its new path, so the
    // path it left is read here.
    for (const entry of staged.value) {
      if (entry.from === undefined || readings.some((reading) => reading.path === entry.from)) continue;
      const kind = lifecycleKindOf(entry.from, planDir.value.trim(), sprintDir.value.trim());
      if (kind !== null) readings.push({ path: entry.from, kind, head: await headOf(entry.from), committed: null });
    }

    const receipts = stateReceiptsFile(root.value, gitBlobOid);
    const uncleared = [];
    for (const transition of stateTransitionsOf(readings, planDir.value.trim(), sprintDir.value.trim())) {
      const { key, value } = receiptOf(transition);
      const spent = await receipts.spend(key, value);
      if (!(spent.ok && spent.value)) uncleared.push(transition);
    }
    return stateTransitionRefusal(uncleared);
  },
  onError: 'allow',
};

/**
 * The plan's spike branch where it records `Spike approved:`, else `''`.
 *
 * Parses the plan text in a private scratch directory; an unparseable plan
 * admits nothing.
 */
const approvedSpikeOf = async (text: string, planPath: string, cwd: string, scriptDir: string): Promise<string> => {
  const { planStoreShell } = await import('@plot-pm/domain/adapters/plan-store/plan-store-shell');
  const { spikeOf } = await import('@plot-pm/domain/rules/spike');
  const store = planStoreShell({ repoRoot: cwd, scriptDir });
  const dir = mkdtempSync(join(tmpdir(), 'plot-gate-plan-'));
  try {
    const scratch = join(dir, basename(planPath));
    const written = await store.writeText(scratch, text);
    if (!written.ok) return '';
    const read = await store.readPlan(scratch);
    if (!read.ok || read.value.spikeApprovedRaw.trim() === '') return '';
    return spikeOf(read.value.slices.map((slice) => ({ branches: slice.branches })))?.branch ?? '';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * `phase`: refuses an implementation commit while its plan is still Draft or
 * Design on a shared ref, and a commit on a branch named in `.plot/hold`.
 *
 * `wants` is a pure string test. `ask` reads the current branch, the config
 * (`Plan directory`, `Story directory`, `Branch prefixes`, `Main branch`) and
 * `effectivePaths`. `holdRefusal` runs first and for any branch. For a branch
 * under an implementation prefix whose commit carries a path outside the
 * plan directory, it reads the plan from `origin/<main>`, then
 * from `origin/<branch>`, never the working tree. A plan on neither shared ref
 * but present locally, and an unreadable `origin/<main>`, allow and print that
 * the phase went UNVERIFIED; a plan nowhere allows silently. A failed config
 * read throws, which `onError: 'allow'` reports as UNVERIFIED.
 */
const phaseGate: Gate = {
  name: 'phase',
  wants: (command) => command.includes('git commit'),
  ask: async (command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { scriptsShell } = await import('@plot-pm/domain/adapters/scripts/scripts-shell');
    const { effectivePaths } = await import('@plot-pm/domain/rules/state-transition');
    const {
      holdRefusal,
      implementationPrefixesOf,
      outsidePlanDir,
      phaseGateRefusal,
      planPathFor,
      planPhaseOf,
      slugOfBranch,
      unpushedPlanNote,
      unreadableRefNote,
    } = await import('@plot-pm/domain/rules/phase-gate');

    const cwd = process.cwd();
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const refs = refsGit({ repoRoot: cwd, scriptDir });
    const branchRead = await refs.currentBranch();
    const root = await refs.repoRoot();
    if (!branchRead.ok || !root.ok) return null;
    const branch = branchRead.value;

    const scripts = scriptsShell({ repoRoot: cwd, scriptDir });
    const planDirRead = await scripts.config('Plan directory', 'docs/plans/');
    const storyDirRead = await scripts.config('Story directory', 'docs/stories/');
    const prefixRead = await scripts.config('Branch prefixes', 'idea/, feature/, bug/, docs/, infra/');
    if (!planDirRead.ok || !storyDirRead.ok || !prefixRead.ok) {
      throw new Error('the Plan directory, Story directory or Branch prefixes config read failed');
    }
    const homes = {
      planDir: planDirRead.value.trim().replace(/\/+$/, ''),
      storyDir: storyDirRead.value.trim().replace(/\/+$/, ''),
    };

    const staged = await refs.stagedPaths();
    const workingChanges = await refs.workingChanges();
    const showPrefix = await refs.showPrefix();
    const paths = (
      staged.ok
        ? effectivePaths(
            {
              staged: staged.value.map((entry) => entry.path),
              workingChanges: workingChanges.ok ? workingChanges.value : [],
              showPrefix: showPrefix.ok ? showPrefix.value : '',
            },
            command,
          )
        : []
    ).map((entry) => entry.path);

    let hold: string | null = null;
    try {
      hold = readFileSync(join(root.value, '.plot', 'hold'), 'utf8');
    } catch {
      // No hold file holds nothing.
    }
    const held = holdRefusal({ branch, hold, paths, ...homes });
    if (held !== null) return held;

    const slug = slugOfBranch(branch, implementationPrefixesOf(prefixRead.value));
    if (slug === null || !paths.some((path) => outsidePlanDir(path, homes.planDir))) return null;

    const mainRead = await scripts.config('Main branch', '');
    let main = mainRead.ok ? mainRead.value.trim() : '';
    if (main === '') {
      const head = await refs.defaultBranch();
      main = head.ok && head.value.trim() !== '' ? head.value.trim() : 'main';
    }
    let ref = `origin/${main}`;
    const mainTip = await refs.resolve(`${ref}^{commit}`);
    if (!mainTip.ok) {
      process.stderr.write(`${unreadableRefNote(ref)}\n`);
      return null;
    }

    // `ls-tree` reads its pathspec against the cwd, so the plan is listed
    // from the repository root: a commit run from a subdirectory reads the
    // same plan directory as one run from the top.
    const atRoot = refsGit({ repoRoot: root.value, scriptDir });
    const planOn = async (at: string): Promise<string | null> => {
      const tip = await refs.resolve(`${at}^{commit}`);
      if (!tip.ok) return null;
      const blobs = await atRoot.listBlobs(at, `${homes.planDir}/`);
      return blobs.ok ? planPathFor(blobs.value.map((blob) => blob.path), homes.planDir, slug) : null;
    };
    let planPath = await planOn(ref);
    if (planPath === null) {
      planPath = await planOn(`origin/${branch}`);
      if (planPath === null) {
        let local: string[] = [];
        try {
          local = readdirSync(join(root.value, homes.planDir)).map((name) => `${homes.planDir}/${name}`);
        } catch {
          // No plan directory: no local plan.
        }
        if (planPathFor(local, homes.planDir, slug) !== null) {
          process.stderr.write(`${unpushedPlanNote(slug, ref, branch)}\n`);
        }
        return null;
      }
      ref = `origin/${branch}`;
    }

    const text = await refs.showFile(ref, planPath);
    if (!text.ok) return null;
    const phase = planPhaseOf(text.value);
    // Only a Design plan can admit a branch, so only then is the plan parsed.
    const spikeBranch = phase === 'design' ? await approvedSpikeOf(text.value, planPath, cwd, scriptDir) : '';
    return phaseGateRefusal({ branch, slug, ref, phase, paths, planDir: homes.planDir, spikeBranch });
  },
  onError: 'allow',
};

/** Where a call runs, read from git. */
export interface Where {
  /** The repository's top-level path, or a failure where no git answers. */
  readonly root: { ok: true; value: string } | { ok: false };
  /** Whether the checkout is a linked worktree — a desk. */
  readonly linked: boolean;
}

/** Reads {@link Where} through the refs port: `--show-toplevel`, then `--absolute-git-dir` against `--git-common-dir`. */
const gitWhere = async (cwd: string, scriptDir: string): Promise<Where> => {
  const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
  const refs = refsGit({ repoRoot: cwd, scriptDir });
  const root = await refs.repoRoot();
  if (!root.ok) return { root: { ok: false }, linked: false };
  const linked = await refs.linkedWorktree();
  return { root, linked: linked.ok && linked.value };
};

/** The backend `plot-host.sh` resolves, or `''` where it does not answer. */
const hostBackend = async (cwd: string, scriptDir: string): Promise<string> => {
  const { hostShell } = await import('@plot-pm/domain/adapters/host/host-shell');
  const backend = await hostShell({ repoRoot: cwd, scriptDir }).backend();
  return backend.ok ? backend.value : '';
};

/** Whether `dir` holds one of the markers of a managed process. */
const holdsMarker = (dir: string): boolean => MANAGED_PROCESS_MARKERS.some((marker) => existsSync(join(dir, marker)));

/**
 * Whether `dir` or a directory above it holds `.plot-worker.pid`, the marker a
 * desk holds, or `.plot-verify.pid`, the marker of a verification run's `pin/`.
 *
 * PARTIAL: this closes the `CI suites` refusal for a tree that carries the
 * marker. Telling a verification session from an ordinary checkout at every
 * other call site of the controller gate ships with the next plugin release.
 */
const underDesk = (dir: string): boolean => {
  for (let at = dir; ; at = dirname(at)) {
    if (holdsMarker(at)) return true;
    if (dirname(at) === at) return false;
  }
};

/** What the controller gate reads from the world, so a test can replace it. */
export interface ControllerReadings {
  readonly desk: (cwd: string) => boolean;
  readonly where: (cwd: string, scriptDir: string) => Promise<Where>;
  readonly backend: (cwd: string, scriptDir: string) => Promise<string>;
}

/**
 * `controller`: refuses a command that runs a controller-owned action
 * (`dispatch`, `approve`, `deliver`, `release`) without the controller's
 * receipt, and a `gh pr merge` or `pr-merge` with no head pin.
 *
 * `ask` runs in order: the single-quoted heredoc strip; two text tests that
 * read no git — the per-word prefilter, and for an unattended agent
 * (`PLOT_UNATTENDED=1`) whether the working directory or one above it holds
 * `.plot-worker.pid` or `.plot-verify.pid`; when both answer no, the call is
 * allowed here. Then git is read once: the repository root and whether it is a
 * linked worktree. The CI-suite arm runs for an unattended agent in a linked
 * worktree holding `.plot-worker.pid` or `.plot-verify.pid`. After the prefilter: no git allows and says it went
 * UNVERIFIED; a linked worktree (a desk) is a worker's own call and is
 * allowed; then `controllerInvocation`, `unpinnedMerges` and the action
 * receipt, which is read and left in place. An unpinned `plot-host.sh
 * pr-merge` goes through where `plot-host.sh backend` answers `bitbucket`. No
 * `.plot/state/` allows the action and says it went UNVERIFIED.
 *
 * A git reading that throws allows the call and says so, unless the command
 * runs a controller-owned action or an unpinned merge: that refuses, because
 * the gate cannot tell a desk from the master agent.
 */
export const controllerGateOf = (readings: ControllerReadings): Gate => ({
  name: 'controller',
  wants: (command) => (process.env.PLOT_UNATTENDED === '1' && command !== '') || mayRunController(command),
  ask: async (command) => {
    const stripped = withoutQuotedHeredocs(command);
    const cwd = process.cwd();
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const named = mayRunController(stripped);
    const atDesk = process.env.PLOT_UNATTENDED === '1' && readings.desk(cwd);
    if (!named && !atDesk) return null;

    let where: Where;
    try {
      where = await readings.where(cwd, scriptDir);
    } catch (error) {
      if (named && (controllerInvocation(stripped) !== null || unpinnedMerges(stripped).length > 0)) throw error;
      process.stderr.write('plot-controller-gate: git could not be read here — controller routing went UNVERIFIED.\n');
      return null;
    }
    const { root, linked } = where;

    if (atDesk && root.ok && linked && holdsMarker(root.value)) {
      try {
        const { refuse } = await import('./local-checks.js');
        let text = '';
        const code = await refuse(root.value, scriptDir, stripped, (s) => {
          text += s;
        });
        if (code === 3) return text.trimEnd();
      } catch {
        // A check against habit: a failure here allows, as the shell arm's ERR trap did.
      }
    }

    if (!named) return null;
    if (!root.ok) {
      process.stderr.write('plot-controller-gate: no git here — controller routing went UNVERIFIED.\n');
      return null;
    }
    if (linked) return null;

    const action = controllerInvocation(stripped);
    const refusals: string[] = [];
    for (const program of unpinnedMerges(stripped)) {
      if (pinUnavailable(program, hostPinsMerges(await readings.backend(cwd, scriptDir)))) {
        process.stderr.write(`${UNPINNABLE_NOTE}\n`);
      } else {
        refusals.push(unpinnedMergeRefusal(scriptDir, program));
      }
    }
    if (action !== null) {
      if (!existsSync(join(root.value, '.plot', 'state'))) {
        process.stderr.write(`plot-controller-gate: no .plot/state/ — controller routing went UNVERIFIED for ${action}.\n`);
      } else {
        const { actionReceiptsFile } = await import('@plot-pm/domain/adapters/action-receipts/action-receipts-file');
        const cleared = await actionReceiptsFile(root.value).clears(action);
        if (!(cleared.ok && cleared.value)) refusals.unshift(controllerRefusal(action, scriptDir, carriesSpikeFlag(stripped)));
      }
    }
    return refusals.length === 0 ? null : refusals.join('\n').trimEnd();
  },
  onError: 'refuse',
});

const controllerGate = controllerGateOf({ desk: underDesk, where: gitWhere, backend: hostBackend });

/** The registered gates. */
export const GATES: readonly Gate[] = [bundleCommitGate, briefNameGate, stateGate, controllerGate, phaseGate];

/** The exit codes the hook contract reads. */
export const EXIT = { allow: 0, refuse: 2 } as const;

/**
 * The Bash command out of the hook JSON. Unreadable input, a missing field or
 * a non-string yields the empty string, which no gate wants.
 */
export const commandOf = (stdin: string): string => {
  try {
    const command = (JSON.parse(stdin) as { tool_input?: { command?: unknown } })?.tool_input?.command;
    return typeof command === 'string' ? command : '';
  } catch {
    return '';
  }
};

/**
 * Run the named gates (every registered gate when `names` is `'all'`) against
 * one command. Returns the exit code; each refusal goes to `warn`.
 */
export const runGates = async (
  gates: readonly Gate[],
  names: readonly string[] | 'all',
  command: string,
  warn: (line: string) => void,
): Promise<number> => {
  const selected =
    names === 'all'
      ? gates
      : names.flatMap((name) => {
          const gate = gates.find((g) => g.name === name);
          if (!gate) warn(`plot-gate: no gate named ${name} — it did not run`);
          return gate ? [gate] : [];
        });
  let code: number = EXIT.allow;
  for (const gate of selected) {
    try {
      if (!gate.wants(command)) continue;
      const refusal = await gate.ask(command);
      if (refusal !== null) {
        warn(refusal);
        code = EXIT.refuse;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (gate.onError === 'refuse') {
        warn(`plot-gate: the ${gate.name} gate failed (${reason}) — it refuses the call because it could not answer`);
        code = EXIT.refuse;
      } else {
        warn(`plot-gate: the ${gate.name} gate failed (${reason}) — it went UNVERIFIED`);
      }
    }
  }
  return code;
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

/** The CLI: `--list`, `--all`, or gate names. Writes refusals to stderr. */
export const run = async (argv: readonly string[]): Promise<number> => {
  if (argv.includes('--list')) {
    for (const gate of GATES) process.stdout.write(`${gate.name}\n`);
    return EXIT.allow;
  }
  const names = argv.filter((a) => !a.startsWith('--'));
  const all = argv.includes('--all');
  if (!all && names.length === 0) return EXIT.allow;
  const command = commandOf(await readStdin());
  return runGates(GATES, all ? 'all' : names, command, (line) => process.stderr.write(`${line}\n`));
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `deliver.ts` records: `/tmp` is a symlink on macOS.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(await run(process.argv.slice(2)));
}
