import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MANAGED_PROCESS_MARKERS, controllerInvocation } from '@plot-pm/domain/rules/ci-suite';
import {
  carriesSpikeFlag,
  controllerRefusal,
  mayRunController,
  unpinnedMergeRefusal,
  unpinnedMerges,
  withoutMessageSinks,
  withoutQuotedHeredocs,
} from '@plot-pm/domain/rules/controller-gate';
import { briefPushRefusal, gatesBriefPush, pushesBriefBranch } from '@plot-pm/domain/rules/brief-push';
import {
  commitDirs,
  gatesMainCheckout,
  gatesStrandingReset,
  gitWriteDirs,
  mainCheckoutWriteRefusal,
  makesCommit,
  mutatesGitState,
  strandingResetRefusal,
  strandsTree,
  treeStrandingResetDirs,
} from '@plot-pm/domain/rules/main-checkout-write';
import { SPAWN_CONTRACT, spawnContractReading } from '@plot-pm/domain/rules/spawn-contract';
import { gateInsideTree, gateInsideTreeRefusal, roleDeniesCommand, roleDeniesPath } from '@plot-pm/domain/rules/role-gate';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

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
 * The distinct repository roots a commit-gate must ask about for `command`,
 * resolved from {@link commitDirs} against `cwd`. One entry per distinct
 * root — never one per `commitDirs` entry — because the `state` gate spends a
 * single-use receipt per transition: `git commit -m a && git -C sub commit -m
 * b` in one worktree must ask once, or a second ask finds its own receipt
 * already spent and refuses a transition its first ask already cleared.
 *
 * An `'unplaced'` entry (a `-C` or `cd` argument the text cannot give) is
 * read at `process.cwd()`, same as a gate with no root loop would read it
 * today, and reported on stderr naming `gateName` and `command` — the panel's
 * explicit rejection of a silent allow for a call no root loop can place.
 *
 * A command with no committing call the walk can read — one only the
 * `git commit` substring floor matches — is read at `cwd`, so each gate takes
 * its whole-line reading there.
 *
 * A root `refs.repoRoot()` cannot resolve is dropped: with no root, a gate
 * cannot place the call in any checkout to ask about, the same as today's
 * single-root gates already read a failed `repoRoot()` as "nothing to ask".
 *
 * @param command - the command line.
 * @param cwd - the working directory the hook itself runs in.
 * @param scriptDir - the script directory passed to `refsGit`.
 * @param gateName - the gate naming an unplaced entry on stderr.
 */
const commitRootsFor = async (command: string, cwd: string, scriptDir: string, gateName: string): Promise<readonly string[]> => {
  const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
  const roots = new Set<string>();
  const dirs = commitDirs(command);
  // A line only the `git commit` substring floor matches (`bash -c "git
  // commit -am x"`, `sudo git commit`) has no committing call the walk can
  // read, so it is read at `cwd` as a whole line.
  for (const dir of dirs.length === 0 ? [null] : dirs) {
    if (dir === 'unplaced') {
      process.stderr.write(`${gateName}: a committing call's directory is not given in the text: ${command}\n`);
    }
    const at = dir === 'unplaced' || dir === null ? cwd : resolve(cwd, dir);
    const root = await refsGit({ repoRoot: at, scriptDir }).repoRoot();
    if (root.ok) roots.add(root.value);
  }
  return [...roots];
};

/**
 * `bundle-commit`: refuses a commit that stages a generated board bundle.
 *
 * `wants` is a pure string test — no adapter loads for a command with no
 * `git commit` in it. `ask` asks once per distinct repository root among the
 * committing calls `command` makes ({@link commitRootsFor}); within a root it
 * reads that root's `packages/board/build.mjs` (a repository with none builds
 * no bundle, so it allows), the staged paths and, only when one of them is in
 * the declared set, the merge base the commit will have against
 * `origin/main` (over every `MERGE_HEAD` during a merge) and the (mode, sha)
 * it holds at each such path. All of it goes to {@link bundleCommitRefusal},
 * which compares it with the index; the first root that refuses decides.
 */
const bundleCommitGate: Gate = {
  name: 'bundle-commit',
  wants: (command) => command.includes('git commit') || makesCommit(command),
  ask: async (command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { bundleCommitPaths, bundleCommitRefusal, shippedPathsOf } = await import(
      '@plot-pm/domain/rules/bundle-commit'
    );

    const cwd = process.cwd();
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const roots = await commitRootsFor(command, cwd, scriptDir, 'bundle-commit');
    for (const root of roots) {
      const refs = refsGit({ repoRoot: root, scriptDir });

      const buildFile = join(root, 'packages/board/build.mjs');
      if (!existsSync(buildFile)) continue;
      const generated = shippedPathsOf(readFileSync(buildFile, 'utf8'));
      if (generated.length === 0) continue;

      const staged = await refs.stagedEntries();
      if (!staged.ok) continue;
      const touched = bundleCommitPaths({ generated, staged: staged.value });
      if (touched.length === 0) continue;

      // The base the commit will have: against a merge in progress, the merge
      // base of `origin/main`, `HEAD` and every `MERGE_HEAD`. Every failed read
      // reaches the rule as `null` and refuses there.
      const parents = await refs.mergeParents();
      const heads: string[] = [];
      let readable = parents.ok;
      for (const head of parents.ok ? parents.value : []) {
        const resolved = await refs.resolve(head);
        if (resolved.ok) heads.push(resolved.value);
        else readable = false;
      }
      const mergeBaseResult = readable ? await refs.mergeBase('origin/main', 'HEAD', ...heads) : null;
      const mergeBase = mergeBaseResult?.ok ? mergeBaseResult.value : null;
      const entries = mergeBase === null ? null : await refs.entriesAt(mergeBase, touched);
      const mainTip = await refs.resolve('origin/main');

      const refusal = bundleCommitRefusal({
        generated,
        staged: staged.value,
        mergeBase,
        atMergeBase: entries?.ok ? entries.value : null,
        mainTip: mainTip.ok ? mainTip.value : null,
        merging: heads.length > 0,
      });
      if (refusal !== null) return refusal;
    }
    return null;
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
  wants: (command) => command.includes('git commit') || makesCommit(command),
  ask: async (command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { scriptsShell } = await import('@plot-pm/domain/adapters/scripts/scripts-shell');
    const { DEFAULT_BRANCH_PREFIXES, briefNameCandidates, briefNameRefusal, briefPrefixesOf, chainedStagesOf } =
      await import('@plot-pm/domain/rules/brief-name');

    const cwd = process.cwd();
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const roots = await commitRootsFor(command, cwd, scriptDir, 'brief-name');
    const chained = chainedStagesOf(command);
    const at = (dir: string | null | 'unplaced') => (dir === null || dir === 'unplaced' ? cwd : resolve(cwd, dir));
    const rootOf = async (dir: string | null | 'unplaced') => {
      const read = await refsGit({ repoRoot: at(dir), scriptDir }).repoRoot();
      return read.ok ? read.value : null;
    };

    for (const root of roots) {
      const refs = refsGit({ repoRoot: root, scriptDir });
      const config = await scriptsShell({ repoRoot: root, scriptDir }).config('Branch prefixes', DEFAULT_BRANCH_PREFIXES);
      if (!config.ok) throw new Error('the Branch prefixes config read failed');
      const prefixes = briefPrefixesOf(config.value);

      const staged = await refs.stagedPaths();
      if (!staged.ok) continue;

      const untracked: string[] = [];
      for (const add of chained.adds) {
        if ((await rootOf(add.dir)) !== root) continue;
        const callRefs = refsGit({ repoRoot: at(add.dir), scriptDir });
        const showPrefix = await callRefs.showPrefix();
        if (!showPrefix.ok) continue;
        const pathspec = add.spec === null ? null : `${showPrefix.value}${add.spec}`;
        const paths = await refs.untrackedPaths(pathspec);
        if (paths.ok) untracked.push(...paths.value);
      }
      const moves: string[] = [];
      for (const move of chained.moves) {
        if ((await rootOf(move.dir)) !== root) continue;
        const showPrefix = await refsGit({ repoRoot: at(move.dir), scriptDir }).showPrefix();
        if (showPrefix.ok) moves.push(`${showPrefix.value}${move.dest}`);
      }
      const landed = { staged: staged.value, untracked, moves, prefixes };
      const candidates = briefNameCandidates(landed);
      if (candidates.length === 0) continue;

      const inHead = new Set<string>();
      const texts = new Map<string, string>();
      const present = new Set<string>();
      for (const { path, want } of candidates) {
        const held = refs.fileExistsSync('HEAD', path);
        if (held.ok && held.value) inHead.add(path);
        try {
          texts.set(path, readFileSync(join(root, path), 'utf8'));
        } catch {
          // No text in the working tree reads as no branch named.
        }
        if (existsSync(join(root, want))) present.add(want);
      }
      const branches = new Set<string>();
      for (const remote of [false, true]) {
        const names = await refs.listBranches(remote);
        if (names.ok) for (const name of names.value) branches.add(name);
      }

      const refusal = briefNameRefusal({ ...landed, inHead, branches, texts, present });
      if (refusal !== null) return refusal;
    }
    return null;
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
 * mode git holds, or `lstat` for a working copy, which is never followed).
 * It also reads `MERGE_HEAD` (worktree-aware, octopus included) and, for each
 * path, every other parent's version the same way; a plain commit reads
 * `MERGE_HEAD` as absent and so reads no other parents. `stateTransitionsOf`
 * finds the transitions — a merge whose staged text equals another parent's
 * clears with no receipt — and only then is a path's receipt spent. A failed
 * config read throws, which `onError: 'allow'` reports as UNVERIFIED; an
 * unreadable `HEAD` or index allows. A transition seen with no clearing
 * receipt refuses.
 */
const stateGate: Gate = {
  name: 'state',
  wants: (command) => command.includes('git commit') || makesCommit(command),
  ask: async (command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { scriptsShell } = await import('@plot-pm/domain/adapters/scripts/scripts-shell');
    const { stateReceiptsFile } = await import('@plot-pm/domain/adapters/state-receipts/state-receipts-file');
    const { chainedAddsOf } = await import('@plot-pm/domain/rules/chained-add');
    const { commitCallsOf } = await import('@plot-pm/domain/rules/main-checkout-write');
    const {
      SYMLINK_MODE,
      effectivePaths,
      lifecycleKindOf,
      pickedClears,
      pickedTransitionOf,
      receiptOf,
      stateTransitionRefusal,
      stateTransitionsOf,
    } = await import('@plot-pm/domain/rules/state-transition');
    const { gitBlobOid } = await import('./ladder.js');

    const cwd = process.cwd();
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const roots = await commitRootsFor(command, cwd, scriptDir, 'state');
    const calls = commitCallsOf(command);
    const at = (dir: string | null | 'unplaced') => (dir === null || dir === 'unplaced' ? cwd : resolve(cwd, dir));

    // `effectivePaths`'s `inRoot` is a synchronous predicate, so every distinct
    // dir a chained add or committing call names is resolved to its own root
    // once, ahead of the per-root loop below.
    const rootByDir = new Map<string | null | 'unplaced', string | null>();
    const resolveDir = async (dir: string | null | 'unplaced') => {
      if (rootByDir.has(dir)) return;
      const read = await refsGit({ repoRoot: at(dir), scriptDir }).repoRoot();
      rootByDir.set(dir, read.ok ? read.value : null);
    };
    for (const add of chainedAddsOf(command)) await resolveDir(add.dir);
    for (const call of calls) await resolveDir(call.placed ? call.dir : 'unplaced');

    const uncleared = [];

    for (const root of roots) {
      const refs = refsGit({ repoRoot: root, scriptDir });

      const scripts = scriptsShell({ repoRoot: root, scriptDir });
      const planDir = await scripts.config('Plan directory', 'docs/plans/');
      const sprintDir = await scripts.config('Sprint directory', 'docs/sprints/');
      if (!planDir.ok || !sprintDir.ok) throw new Error('the Plan directory or Sprint directory config read failed');

      const staged = await refs.stagedEntries();
      const workingChanges = await refs.workingChanges();
      const showPrefix = await refs.showPrefix();
      if (!staged.ok) continue;

      const own = calls.find((call) => call.placed && rootByDir.get(call.dir) === root);
      const commitArgs = own === undefined ? null : own.args;
      const carried = effectivePaths(
        {
          staged: staged.value.map((entry) => entry.path),
          workingChanges: workingChanges.ok ? workingChanges.value : [],
          showPrefix: showPrefix.ok ? showPrefix.value : '',
        },
        command,
        commitArgs,
        (dir) => rootByDir.get(dir) === root,
      );

      // `ls-tree` reads its pathspec against the cwd, so `HEAD`'s mode is read
      // from the repository root.
      const atRoot = refsGit({ repoRoot: root, scriptDir });
      const versionAt = async (ref: string, path: string) => {
        const text = await refs.showFile(ref, path);
        if (!text.ok) return null;
        const blobs = await atRoot.listBlobs(ref, path);
        const link = blobs.ok && blobs.value.some((blob) => blob.path === path && blob.mode === SYMLINK_MODE);
        return { text: text.value, link };
      };
      const headOf = (path: string) => versionAt('HEAD', path);
      // `MERGE_HEAD` exists only between a merge that did not fast-forward and
      // the commit that completes it, so a plain commit reads no other parents.
      const mergeParents = await refs.mergeParents();
      const otherParentShas = mergeParents.ok ? mergeParents.value : [];
      const otherParentsOf = async (path: string) =>
        Promise.all(otherParentShas.map((sha) => versionAt(sha, path)));
      const indexModes = new Map(staged.value.map((entry) => [entry.path, entry.indexMode]));
      const readings = [];
      for (const { path, carries } of carried) {
        const kind = lifecycleKindOf(path, planDir.value.trim(), sprintDir.value.trim());
        if (kind === null) continue;
        let committed = null;
        if (carries === 'working') {
          try {
            const full = join(root, path);
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
        readings.push({ path, kind, head: await headOf(path), committed, otherParents: await otherParentsOf(path) });
      }
      // Git pairs a staged rename into one entry under its new path, so the
      // path it left is read here.
      for (const entry of staged.value) {
        if (entry.from === undefined || readings.some((reading) => reading.path === entry.from)) continue;
        const kind = lifecycleKindOf(entry.from, planDir.value.trim(), sprintDir.value.trim());
        if (kind !== null) {
          readings.push({
            path: entry.from,
            kind,
            head: await headOf(entry.from),
            committed: null,
            otherParents: await otherParentsOf(entry.from),
          });
        }
      }

      // A rebase or cherry-pick stopped on a conflict re-presents the commit it is
      // replaying; its own first run already spent the receipt, so a transition
      // the picked commit made identically against its own first parent clears
      // with no second receipt. `git am --continue` leaves neither file and reads
      // as a plain commit, carrying no picked commit to compare against.
      const pickedRead = await refs.pickedHead();
      const pickedSha = pickedRead.ok ? pickedRead.value : null;
      const pickedValueAt = async (path: string) => {
        if (pickedSha === null) return null;
        const [parent, picked] = await Promise.all([refs.showFile(`${pickedSha}^`, path), refs.showFile(pickedSha, path)]);
        return { parentText: parent.ok ? parent.value : null, pickedText: picked.ok ? picked.value : null };
      };

      const receipts = stateReceiptsFile(root, gitBlobOid);
      for (const transition of stateTransitionsOf(readings, planDir.value.trim(), sprintDir.value.trim())) {
        const { key, value } = receiptOf(transition);
        const spent = await receipts.spend(key, value);
        if (spent.ok && spent.value) continue;
        const picked = await pickedValueAt(transition.path);
        if (picked !== null) {
          const { before, after } = pickedTransitionOf(transition.field, picked.parentText, picked.pickedText);
          if (pickedClears(transition, before, after)) continue;
        }
        uncleared.push(transition);
      }
    }
    return stateTransitionRefusal(uncleared);
  },
  onError: 'allow',
};

/**
 * Refuses a commit that adds or moves a sprint member line onto an open sprint
 * while the plan's `- **Sprint:**` field disagrees with `sprintOfPlan` over the
 * tree the commit leaves.
 *
 * Reads what `stateGate` reads: `effectivePaths` decides which paths the commit
 * carries and whether each takes the staged text or the working copy. `HEAD` is
 * the base. A plan whose field a commit sets to a sprint that does not list it
 * is reported on stderr and never refused. A failed config read throws, which
 * `onError: 'allow'` reports as UNVERIFIED.
 */
const sprintMemberGate: Gate = {
  name: 'sprint-member',
  wants: (command) => command.includes('git commit') || makesCommit(command),
  ask: async (command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { scriptsShell } = await import('@plot-pm/domain/adapters/scripts/scripts-shell');
    const { chainedAddsOf } = await import('@plot-pm/domain/rules/chained-add');
    const { commitCallsOf } = await import('@plot-pm/domain/rules/main-checkout-write');
    const { effectivePaths } = await import('@plot-pm/domain/rules/state-transition');
    const { sprintMemberRefusalText } = await import('@plot-pm/domain/rules/sprint-member-gate');
    const { checkSprintMembers } = await import('./sprint-member-check.js');

    const cwd = process.cwd();
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const roots = await commitRootsFor(command, cwd, scriptDir, 'sprint-member');
    const calls = commitCallsOf(command);
    const at = (dir: string | null | 'unplaced') => (dir === null || dir === 'unplaced' ? cwd : resolve(cwd, dir));
    const rootByDir = new Map<string | null | 'unplaced', string | null>();
    const resolveDir = async (dir: string | null | 'unplaced') => {
      if (rootByDir.has(dir)) return;
      const read = await refsGit({ repoRoot: at(dir), scriptDir }).repoRoot();
      rootByDir.set(dir, read.ok ? read.value : null);
    };
    for (const add of chainedAddsOf(command)) await resolveDir(add.dir);
    for (const call of calls) await resolveDir(call.placed ? call.dir : 'unplaced');

    const texts: string[] = [];
    for (const root of roots) {
      const refs = refsGit({ repoRoot: root, scriptDir });
      const scripts = scriptsShell({ repoRoot: root, scriptDir });
      const planDirRead = await scripts.config('Plan directory', 'docs/plans/');
      const sprintDirRead = await scripts.config('Sprint directory', 'docs/sprints/');
      if (!planDirRead.ok || !sprintDirRead.ok) throw new Error('the Plan directory or Sprint directory config read failed');
      const planDir = planDirRead.value.trim().replace(/\/+$/, '');
      const sprintDir = sprintDirRead.value.trim().replace(/\/+$/, '');

      const staged = await refs.stagedEntries();
      const workingChanges = await refs.workingChanges();
      const showPrefix = await refs.showPrefix();
      if (!staged.ok) continue;
      const own = calls.find((call) => call.placed && rootByDir.get(call.dir) === root);
      const carried = effectivePaths(
        {
          staged: staged.value.map((entry) => entry.path),
          workingChanges: workingChanges.ok ? workingChanges.value : [],
          showPrefix: showPrefix.ok ? showPrefix.value : '',
        },
        command,
        own === undefined ? null : own.args,
        (dir) => rootByDir.get(dir) === root,
      );

      // What the commit leaves, per carried path; `null` is a deletion.
      const left = new Map<string, string | null>();
      for (const { path, carries } of carried) {
        if (!path.startsWith(`${planDir}/`) && !path.startsWith(`${sprintDir}/`)) continue;
        if (carries === 'working') {
          try {
            left.set(path, readFileSync(join(root, path), 'utf8'));
          } catch {
            left.set(path, null);
          }
        } else {
          const index = await refs.showFile(':0', path);
          left.set(path, index.ok ? index.value : null);
        }
      }
      if (left.size === 0) continue;

      const headText = async (path: string) => {
        const text = await refs.showFile('HEAD', path);
        return text.ok ? text.value : null;
      };
      const listed = async (dir: string) => {
        const base = dir.replace(/\/+$/, '');
        const blobs = await refs.listBlobs('HEAD', base);
        const names = new Set((blobs.ok ? blobs.value : []).map((blob) => blob.path));
        for (const [path, text] of left) if (text !== null && path.startsWith(`${base}/`)) names.add(path);
        return [...names].filter((p) => p.endsWith('.md') && !p.slice(base.length + 1).includes('/'));
      };
      const answer = await checkSprintMembers(
        { list: listed, before: headText, after: async (path) => (left.has(path) ? left.get(path)! : headText(path)) },
        [...left.keys()],
        planDir,
        sprintDir,
      );
      for (const notice of answer.notices) {
        process.stderr.write(`sprint-member: plan '${notice.slug}' names sprint '${notice.field}', which does not list it yet (not refused).\n`);
      }
      const text = sprintMemberRefusalText(answer.refusals);
      if (text !== null) texts.push(text);
    }
    return texts.length === 0 ? null : texts.join('\n');
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
  wants: (command) => command.includes('git commit') || makesCommit(command),
  ask: async (command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { scriptsShell } = await import('@plot-pm/domain/adapters/scripts/scripts-shell');
    const { commitCallsOf } = await import('@plot-pm/domain/rules/main-checkout-write');
    const { effectivePaths } = await import('@plot-pm/domain/rules/state-transition');
    const {
      holdRefusal,
      implementationPrefixesOf,
      mergeOwnPathsOf,
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
    const roots = await commitRootsFor(command, cwd, scriptDir, 'phase');
    const calls = commitCallsOf(command);
    const at = (dir: string | null | 'unplaced') => (dir === null || dir === 'unplaced' ? cwd : resolve(cwd, dir));

    // `effectivePaths`'s `inRoot` is a synchronous predicate, so every distinct
    // dir a committing call names is resolved to its own root once, ahead of
    // the per-root loop below.
    const rootByDir = new Map<string | null | 'unplaced', string | null>();
    for (const call of calls) {
      const dir = call.placed ? call.dir : 'unplaced';
      if (rootByDir.has(dir)) continue;
      const read = await refsGit({ repoRoot: at(dir), scriptDir }).repoRoot();
      rootByDir.set(dir, read.ok ? read.value : null);
    }

    for (const root of roots) {
      const refs = refsGit({ repoRoot: root, scriptDir });
      const branchRead = await refs.currentBranch();
      if (!branchRead.ok) continue;
      const branch = branchRead.value;

      const scripts = scriptsShell({ repoRoot: root, scriptDir });
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

      const own = calls.find((call) => call.placed && rootByDir.get(call.dir) === root);
      const commitArgs = own === undefined ? null : own.args;
      const staged = await refs.stagedPaths();
      const workingChanges = await refs.workingChanges();
      const showPrefix = await refs.showPrefix();
      let paths = (
        staged.ok
          ? effectivePaths(
              {
                staged: staged.value.map((entry) => entry.path),
                workingChanges: workingChanges.ok ? workingChanges.value : [],
                showPrefix: showPrefix.ok ? showPrefix.value : '',
              },
              command,
              commitArgs,
              (dir) => rootByDir.get(dir) === root,
            )
          : []
      ).map((entry) => entry.path);

      const mainRead = await scripts.config('Main branch', '');
      let main = mainRead.ok ? mainRead.value.trim() : '';
      if (main === '') {
        const head = await refs.defaultBranch();
        main = head.ok && head.value.trim() !== '' ? head.value.trim() : 'main';
      }
      const mainRef = `origin/${main}`;

      // Completing a conflicted `git merge origin/<main>` stages every path the
      // merge resolved, including every path main touched that the branch never
      // did; those are not the branch's own and must not trip the checks below.
      // The carve-out runs only once every `MERGE_HEAD` commit is confirmed
      // contained in `origin/<main>` — never on `no` or `unknown` — so a merge of
      // some other branch gets no such pass.
      const mergeParentsRead = await refs.mergeParents();
      const mergeParentShas = mergeParentsRead.ok ? mergeParentsRead.value : [];
      if (mergeParentShas.length > 0) {
        const containments = await Promise.all(mergeParentShas.map((sha) => refs.contains(sha, mainRef)));
        if (containments.every((containment) => containment.ok && containment.value === 'yes')) {
          const entries = await refs.stagedEntries();
          const blobs = entries.ok
            ? entries.value.filter((entry) => entry.status !== 'deleted').map((entry) => ({ path: entry.path, sha: entry.indexSha }))
            : [];
          const atMergeHeads = await Promise.all(
            mergeParentShas.map(async (sha) => {
              const read = await refs.entriesAt(sha, blobs.map((blob) => blob.path));
              return read.ok ? read.value : {};
            }),
          );
          const drop = new Set(mergeOwnPathsOf(blobs, atMergeHeads));
          if (drop.size > 0) paths = paths.filter((path) => !drop.has(path));
        }
      }

      let hold: string | null = null;
      try {
        hold = readFileSync(join(root, '.plot', 'hold'), 'utf8');
      } catch {
        // No hold file holds nothing.
      }
      const held = holdRefusal({ branch, hold, paths, ...homes });
      if (held !== null) return held;

      const slug = slugOfBranch(branch, implementationPrefixesOf(prefixRead.value));
      if (slug === null || !paths.some((path) => outsidePlanDir(path, homes.planDir))) continue;

      let ref = mainRef;
      const mainTip = await refs.resolve(`${ref}^{commit}`);
      if (!mainTip.ok) {
        process.stderr.write(`${unreadableRefNote(ref)}\n`);
        continue;
      }

      // `ls-tree` reads its pathspec against the cwd, so the plan is listed
      // from the repository root: a commit run from a subdirectory reads the
      // same plan directory as one run from the top.
      const atRoot = refsGit({ repoRoot: root, scriptDir });
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
            local = readdirSync(join(root, homes.planDir)).map((name) => `${homes.planDir}/${name}`);
          } catch {
            // No plan directory: no local plan.
          }
          if (planPathFor(local, homes.planDir, slug) !== null) {
            process.stderr.write(`${unpushedPlanNote(slug, ref, branch)}\n`);
          }
          continue;
        }
        ref = `origin/${branch}`;
      }

      const text = await refs.showFile(ref, planPath);
      if (!text.ok) continue;
      const phase = planPhaseOf(text.value);
      // Only a Design plan can admit a branch, so only then is the plan parsed.
      const spikeBranch = phase === 'design' ? await approvedSpikeOf(text.value, planPath, root, scriptDir) : '';
      const refusal = phaseGateRefusal({ branch, slug, ref, phase, paths, planDir: homes.planDir, spikeBranch });
      if (refusal !== null) return refusal;
    }
    return null;
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

/**
 * Reads {@link Where} through the refs port: `--show-toplevel`, then
 * `--absolute-git-dir` against `--git-common-dir`.
 *
 * A failed `linkedWorktree()` read reads as `linked: false`, the same as a
 * confirmed main checkout: with `root.ok`, the gate cannot tell a broken read
 * from the main checkout, and refusing is the safer default. A failed
 * `repoRoot()` read is the one case that allows — without a root, the gate
 * cannot place the command in any checkout at all.
 */
const gitWhere = async (cwd: string, scriptDir: string): Promise<Where> => {
  const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
  const refs = refsGit({ repoRoot: cwd, scriptDir });
  const root = await refs.repoRoot();
  if (!root.ok) return { root: { ok: false }, linked: false };
  const linked = await refs.linkedWorktree();
  return { root, linked: linked.ok && linked.value };
};

/** What the main-checkout gate reads from the world, so a test can replace it. */
export interface MainCheckoutReadings {
  readonly where: (cwd: string, scriptDir: string) => Promise<Where>;
}

/**
 * `main-checkout`: refuses an unattended agent's (`PLOT_UNATTENDED=1`) git
 * command that mutates `HEAD`, the index, or a ref in the repository's MAIN
 * checkout rather than a linked (desk) worktree.
 *
 * Without `PLOT_UNATTENDED=1`, or with `PLOT_MAIN_CHECKOUT_WRITER=1`, it allows
 * everything and reads nothing ({@link gatesMainCheckout}): an interactive
 * session, and the deliver, reslice, story, auto-deliver and brief runs whose
 * spawn sets the marker, commit in the main checkout by design. Otherwise
 * `wants` is a string test over {@link mutatesGitState}, so a read-only
 * command never reads git. `ask` reads, for each mutating call, the directory
 * its `cd` and `-C` arguments name (or the working directory) and refuses where that is
 * not a linked worktree. A root read that fails allows: without git this gate
 * cannot tell a desk from the main checkout. A linked-worktree read that fails
 * refuses instead ({@link gitWhere}): with a root, passing a broken read would
 * hide it behind a silent allow.
 *
 * A second arm ignores the marker: a mixed `git reset` in the main checkout is
 * refused for every unattended caller ({@link gatesStrandingReset}), because it
 * leaves the working tree behind `HEAD`. Each arm returns its OWN text: a
 * marked writer whose mixed reset trips the second arm reads {@link
 * strandingResetRefusal}, never a sentence about a missing marker it does
 * carry; the first arm's {@link mainCheckoutWriteRefusal} additionally names a
 * proven spawn-contract skew (#2728), read via {@link spawnContractReading}.
 */
export const mainCheckoutGateOf = (readings: MainCheckoutReadings): Gate => ({
  name: 'main-checkout',
  wants: (command) =>
    (gatesMainCheckout(process.env) && mutatesGitState(command)) || (gatesStrandingReset(process.env) && strandsTree(command)),
  ask: async (command) => {
    const cwd = process.cwd();
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    // A marked writer is exempt from the gate but not from the mixed-reset refusal.
    const mainCheckoutArm = gatesMainCheckout(process.env);
    const dirs = mainCheckoutArm ? gitWriteDirs(command) : treeStrandingResetDirs(command);
    for (const dir of dirs) {
      const where = await readings.where(dir === null ? cwd : resolve(cwd, dir), scriptDir);
      if (where.root.ok && !where.linked) {
        return mainCheckoutArm
          ? mainCheckoutWriteRefusal(scriptDir, spawnContractReading(process.env))
          : strandingResetRefusal(scriptDir);
      }
    }
    return null;
  },
  onError: 'allow',
});

const mainCheckoutGate = mainCheckoutGateOf({ where: gitWhere });

/** What the brief-push gate reads from the world, so a test can replace it. */
export interface BriefPushReadings {
  readonly currentBranch: (cwd: string, scriptDir: string) => Promise<string>;
}

/** The branch `cwd` is on, `''` where git does not answer or HEAD is detached. */
const gitCurrentBranch = async (cwd: string, scriptDir: string): Promise<string> => {
  const { treesGit } = await import('@plot-pm/domain/adapters/trees/trees-git');
  const read = treesGit({ repoRoot: cwd, scriptDir }).currentBranchSync(cwd);
  return read.ok ? read.value : '';
};

/**
 * `brief-push`: refuses a `git push` that writes the branch a `--brief-only`
 * implement run briefs (`PLOT_BRIEF_ONLY=1`, `PLOT_BRIEF_BRANCH`). A remote
 * branch is a claim, so the push holds the slice with no agent behind it.
 *
 * Outside a brief-only run, or with no brief branch named, it allows and reads
 * nothing. `ask` reads the current branch only where the push names no branch.
 */
export const briefPushGateOf = (readings: BriefPushReadings): Gate => ({
  name: 'brief-push',
  wants: (command) => gatesBriefPush(process.env) && !!process.env.PLOT_BRIEF_BRANCH && /\bpush\b/.test(command),
  ask: async (command) => {
    const branch = process.env.PLOT_BRIEF_BRANCH ?? '';
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const current = await readings.currentBranch(process.cwd(), scriptDir);
    return pushesBriefBranch(command, branch, current) ? briefPushRefusal(branch) : null;
  },
  onError: 'allow',
});

const briefPushGate = briefPushGateOf({ currentBranch: gitCurrentBranch });

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
 * `ask` runs in order: the single-quoted heredoc blank, then the
 * message-sink blank ({@link withoutMessageSinks} — a `git commit
 * -m`/`--message` value, the body of a heredoc the `git commit -F -` command
 * itself opens, and a `plot-state-receipt.sh --unowned-action` reason are
 * message text a process never runs, and a span that holds a substitution
 * stays); two text tests that read no git — the per-word prefilter, and
 * for an unattended agent
 * (`PLOT_UNATTENDED=1`) whether the working directory or one above it holds
 * `.plot-worker.pid` or `.plot-verify.pid`; when both answer no, the call is
 * allowed here. Then git is read once: the repository root and whether it is a
 * linked worktree. The CI-suite arm runs for an unattended agent in a linked
 * worktree holding `.plot-worker.pid` or `.plot-verify.pid`. After the prefilter: no git allows and says it went
 * UNVERIFIED; a linked worktree (a desk) is a worker's own call and is
 * allowed; then `controllerInvocation`, `unpinnedMerges` and the action
 * receipt, which is read and left in place. Every backend pins a merge, so
 * an unpinned `gh pr merge` or `plot-host.sh pr-merge` always refuses here,
 * with no backend read needed to tell. No `.plot/state/` allows the action
 * and says it went UNVERIFIED.
 *
 * A git reading that throws allows the call and says so, unless the command
 * runs a controller-owned action or an unpinned merge: that refuses, because
 * the gate cannot tell a desk from the master agent.
 */
export const controllerGateOf = (readings: ControllerReadings): Gate => ({
  name: 'controller',
  wants: (command) => (process.env.PLOT_UNATTENDED === '1' && command !== '') || mayRunController(command),
  ask: async (command) => {
    const stripped = withoutMessageSinks(withoutQuotedHeredocs(command));
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
    const refusals = unpinnedMerges(stripped).map((program) => unpinnedMergeRefusal(scriptDir, program));
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

/** What the role-deny gate reads from the world, so a test can replace it. */
export interface RoleDenyReadings {
  readonly defaultBranch: (cwd: string) => Promise<string>;
  readonly currentBranch: (cwd: string, scriptDir: string) => Promise<string>;
  /** The real path of the running gate bundle. */
  readonly gatePath: () => string;
  /** The real path of the working tree `cwd` lies in, `''` where it lies in none. */
  readonly treeRoot: (cwd: string) => string;
}

/** The real path of this module's own file — the bundle a role's hook runs. */
const ownGatePath = (): string => realpathSync(fileURLToPath(import.meta.url));

/** The nearest directory at or above `cwd` that holds a `.git` entry (a checkout or a worktree), as a real path; `''` where none does. */
const nearestTreeRoot = (cwd: string): string => {
  let dir = realpathSync(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return '';
    dir = parent;
  }
};

/** The repository's default branch, `''` where git does not answer. */
const gitDefaultBranch = async (cwd: string): Promise<string> => {
  const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
  const { shellContext } = await import('@plot-pm/domain/adapters');
  const read = await refsGit(shellContext(cwd)).defaultBranch();
  return read.ok ? read.value : '';
};

/**
 * The `tool_input.file_path` or `tool_input.path` out of the hook JSON —
 * whichever a Write, Edit or NotebookEdit call names. Unreadable input, a
 * missing field or a non-string yields `''`, which {@link roleDeniesPath}
 * never refuses.
 */
export const pathOf = (stdin: string): string => {
  try {
    const toolInput = (JSON.parse(stdin) as { tool_input?: { file_path?: unknown; path?: unknown } })?.tool_input;
    const value = [toolInput?.file_path, toolInput?.path].find((candidate) => typeof candidate === 'string');
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
};

/**
 * `role-deny`: a non-reviewer role's own gate — refuses a commit-status
 * write, a review run, a merge, a push to the default branch, a commit
 * message closing an issue, or a write to a path `rules/role-gate.ts`
 * protects (`.claude/**`, `scripts/check-*.sh`, `skills/plot/scripts/*-gate.sh`,
 * `skills/plot/scripts/board/**`, `.github/workflows/**`, and the role-deny
 * rule and this entry).
 *
 * The settings files run this bundle from `$PLOT_ROLE_GATE`, a path the role
 * start sets to the default branch's copy outside the role's tree, and deny
 * every call when it names no file. When this bundle's own real path lies
 * inside the working tree the hook's cwd is in, every call is refused: a gate
 * the role can rewrite is no gate.
 *
 * Only a role whose settings file wires this gate's name ever runs it — it is
 * not in {@link GATES}, so an unqualified `--all` never applies it to the
 * master agent or a desk worker. The path half reads `path`, a second stdin
 * field `run()` parses alongside `command` and passes through for this gate
 * alone; the five command predicates ignore it, the same way every other
 * gate here ignores the fields it does not read.
 */
export const roleDenyGateOf = (readings: RoleDenyReadings): Gate & { readonly askPath: (path: string) => Promise<string | null> } => ({
  name: 'role-deny',
  wants: (command) => command !== '',
  ask: async (command) => {
    const cwd = process.cwd();
    const gatePath = readings.gatePath();
    if (gateInsideTree(gatePath, readings.treeRoot(cwd))) return gateInsideTreeRefusal(gatePath);
    const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const [defaultBranch, currentBranch] = await Promise.all([
      readings.defaultBranch(cwd),
      readings.currentBranch(cwd, scriptDir),
    ]);
    return roleDeniesCommand(command, defaultBranch, currentBranch);
  },
  askPath: async (path) => {
    if (path === '') return null;
    const gatePath = readings.gatePath();
    if (gateInsideTree(gatePath, readings.treeRoot(process.cwd()))) return gateInsideTreeRefusal(gatePath);
    return roleDeniesPath(path);
  },
  onError: 'refuse',
});

const roleDenyGate = roleDenyGateOf({
  defaultBranch: gitDefaultBranch,
  currentBranch: gitCurrentBranch,
  gatePath: ownGatePath,
  treeRoot: nearestTreeRoot,
});

/** The gates `--list` and `--all` enumerate — every gate the master agent's or a desk worker's own project hooks may run. */
export const GATES: readonly Gate[] = [
  bundleCommitGate,
  briefNameGate,
  stateGate,
  sprintMemberGate,
  controllerGate,
  phaseGate,
  mainCheckoutGate,
  briefPushGate,
];

/**
 * Gates reachable only by naming them explicitly — never through `--list` or
 * `--all`. `role-deny` lives here, not in {@link GATES}: an unqualified
 * `--all` is this repository's own project-wide hook registration
 * (`plot-install-hooks.sh`, `plot-gates.sh`), run by the master agent and a
 * desk worker, and a pinned `gh pr merge --match-head-commit` that the
 * controller gate allows there must not be refused a second time by a gate
 * meant for a non-reviewer role agent's settings file alone.
 */
export const NAME_ONLY_GATES: readonly Gate[] = [roleDenyGate];

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
 *
 * `path` carries `tool_input.file_path`/`tool_input.path` for a Write, Edit or
 * NotebookEdit call — `''` for a Bash call, which no gate here reads a path
 * for. A gate exposing `askPath` (today, only `role-deny`) is also asked
 * against `path` when it is non-empty; every other gate ignores it exactly as
 * it already ignores fields it does not destructure.
 */
export const runGates = async (
  gates: readonly Gate[],
  names: readonly string[] | 'all',
  command: string,
  warn: (line: string) => void,
  path = '',
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
      if (gate.wants(command)) {
        const refusal = await gate.ask(command);
        if (refusal !== null) {
          warn(refusal);
          code = EXIT.refuse;
        }
      }
      const askPath = (gate as Partial<{ askPath: (path: string) => Promise<string | null> }>).askPath;
      if (path !== '' && askPath) {
        const refusal = await askPath(path);
        if (refusal !== null) {
          warn(refusal);
          code = EXIT.refuse;
        }
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

/** The CLI: `--list`, `--all`, `--spawn-contract`, or gate names. Writes refusals to stderr. */
export const run = async (argv: readonly string[]): Promise<number> => {
  if (argv.includes('--list')) {
    for (const gate of GATES) process.stdout.write(`${gate.name}\n`);
    return EXIT.allow;
  }
  // SERVES WAVE 2 ONLY — this wave never calls it. A reader asks an installed
  // gate's own number without loading its whole module graph (#2728).
  if (argv.includes('--spawn-contract')) {
    process.stdout.write(`${SPAWN_CONTRACT}\n`);
    return EXIT.allow;
  }
  const names = argv.filter((a) => !a.startsWith('--'));
  const all = argv.includes('--all');
  if (!all && names.length === 0) return EXIT.allow;
  const stdin = await readStdin();
  const command = commandOf(stdin);
  const path = pathOf(stdin);
  const gates = all ? GATES : [...GATES, ...NAME_ONLY_GATES];
  return runGates(gates, all ? 'all' : names, command, (line) => process.stderr.write(`${line}\n`), path);
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `deliver.ts` records: `/tmp` is a symlink on macOS.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void endEntry(await run(process.argv.slice(2)));
}
