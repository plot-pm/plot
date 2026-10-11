import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
 * `git commit` in it. `ask` imports `refsGit` and `shellContext` lazily, reads
 * the staged paths, the merge base against `origin/main`, and — for each
 * staged path the generated set names — whether the merge base held it, then
 * hands all three to {@link bundleCommitRefusal}.
 */
const bundleCommitGate: Gate = {
  name: 'bundle-commit',
  wants: (command) => command.includes('git commit'),
  ask: async (_command) => {
    const { refsGit } = await import('@plot-pm/domain/adapters/refs/refs-git');
    const { shellContext } = await import('@plot-pm/domain/adapters');
    const { bundleCommitRefusal } = await import('@plot-pm/domain/rules/bundle-commit');

    const refs = refsGit(shellContext(process.cwd()));
    const staged = await refs.stagedPaths();
    if (!staged.ok) return null;

    const mergeBaseResult = await refs.mergeBase('HEAD', 'origin/main');
    const mergeBase = mergeBaseResult.ok ? mergeBaseResult.value : null;

    const existedAtMergeBase: Record<string, boolean> = {};
    if (mergeBase !== null) {
      for (const entry of staged.value) {
        const existed = refs.fileExistsSync(mergeBase, entry.path);
        existedAtMergeBase[entry.path] = existed.ok && existed.value;
      }
    }

    return bundleCommitRefusal({ staged: staged.value, mergeBase, existedAtMergeBase });
  },
  onError: 'allow',
};

/** The registered gates. */
export const GATES: readonly Gate[] = [bundleCommitGate];

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
