import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/** The registered gates. */
export const GATES: readonly Gate[] = [bundleCommitGate, briefNameGate];

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
