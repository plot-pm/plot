// THROUGH THE NARROW PATHS, not the package root. `@plot-pm/domain` re-exports
// every entity and rule, and esbuild bundles what it is given: measured
// 2026-09-03, the root import produced a 334 KB artifact against
// `plot-movable.mjs`'s 1.2 KB — the whole domain, on the launch path of every
// worker, to answer which file to source.
import { readCharter, charterPath, type CharterReading } from '@plot-pm/domain/entities/charter';
import { resolveLaunch, resolvePrompt } from '@plot-pm/domain/rules/prompt';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-worker-loop.sh` runs once, before its first
 * prompt.
 *
 * ```
 * node plot-prompt.mjs /repo reviewer
 * declared	.plot/prompts/reviewer.sh	reviewer
 * ```
 *
 * **A SIXTH artifact, for the reason the third, fourth and fifth ones give.**
 * `plot-ask.mjs` answers by RUNNING `plot-fleet-scan.sh`, so a worker loop
 * asking it would start a scan to find out which prompt to source. This bundle
 * reads one file and spawns nothing.
 *
 * **A bundle rather than an inline import of the domain source.**
 * `plot-worker-loop.sh` is vendored into the published npm package, where
 * `packages/` does not exist — an import through the checkout's path would
 * resolve only in the plot repo, and every worker elsewhere would fall back
 * without saying so.
 *
 * **Tab-separated out.** The caller is bash reading one line, and JSON would
 * mean a `jq` dependency on the launch path.
 *
 * **TWO QUESTIONS, ONE CHARTER READ.** `--capabilities` answers what the same
 * charter declares an agent may do, for `plot-dispatch.sh`'s launch. A
 * subcommand rather than a fourth field on the default line: that line is
 * parsed positionally by `plot-worker-loop.sh`, whose `${rest#*\t}` takes the
 * whole tail, so an appended field lands inside the agent name it prints. And a
 * SEVENTH artifact rather than a subcommand would pay the charter's parse twice
 * to answer two questions about one file.
 */

/**
 * Read the named agent's charter from disk.
 *
 * A MISSING FILE IS `absent`, NOT AN ERROR. Every other read failure — a
 * directory in the charter's place, a permission denial — is `unreadable`,
 * because something is there and could not be believed. Collapsing the two
 * would let an unreadable charter run the fallback prompt silently.
 *
 * @param repoRoot - the repo root the charter path is relative to.
 * @param name - the agent name, or `''` when nothing named one.
 * @returns what the charter says, or why it could not be read.
 */
export const read = (repoRoot: string, name: string): CharterReading => {
  if (name === '') return { read: 'unnamed' };
  const path = `${repoRoot}/${charterPath(name)}`;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return readCharter(name, null);
    return { read: 'unreadable', name, why: `${path}: ${(err as Error).message}` };
  }
  return readCharter(name, text);
};

/**
 * Decide which prompt this agent runs.
 *
 * @param repoRoot - the repo root.
 * @param name - the agent name, or `''`.
 * @returns `<resolution>\t<prompt>\t<detail>`; the prompt is empty on a refusal.
 */
export const answer = (repoRoot: string, name: string): string => {
  const resolution = resolvePrompt(read(repoRoot, name));
  switch (resolution.resolve) {
    case 'declared':
      return `declared\t${resolution.prompt}\t${resolution.charter}\n`;
    case 'fallback':
      return `fallback\t${resolution.prompt}\t${resolution.why}\n`;
    case 'refused':
      return `refused\t\t${resolution.why}\n`;
  }
};

/**
 * Decide what this agent runs — the harness, model and effort it declared.
 *
 * A VERB ON THIS BUNDLE RATHER THAN A SECOND ONE, and the measurement is the
 * argument. The reasons `entry/transition.ts` gives for a separate artifact are
 * about what an entry would DRAG IN — `plot-ask.mjs` runs a whole fleet scan to
 * answer a question, so a launch asking it would scan to find a model name.
 * Here the opposite holds: this bundle already imports `charter.js` and already
 * reads exactly the file a launch must read, so a second artifact would be
 * 330 KB of the same zod schema on disk and a second read of one file on the
 * launch path, for no isolation that this file does not already have.
 *
 * FOUR FIELDS OUT, NOT THREE, and the fourth is the charter's name. A caller
 * that exported three empty strings could not tell a charter declaring nothing
 * from no charter at all, and the log line naming the agent is what makes a
 * launch explicable afterwards.
 *
 * @param repoRoot - the repo root.
 * @param name - the agent name, or `''`.
 * @returns `<resolution>\t<harness>\t<model>\t<effort>\t<detail>`; the three
 *   names are empty on a fallback and on a refusal.
 */
export const launch = (repoRoot: string, name: string): string => {
  const resolution = resolveLaunch(read(repoRoot, name));
  switch (resolution.resolve) {
    case 'declared':
      return `declared\t${resolution.harness}\t${resolution.model}\t${resolution.effort}\t${resolution.charter}\n`;
    case 'fallback':
      return `fallback\t\t\t\t${resolution.why}\n`;
    case 'refused':
      return `refused\t\t\t\t${resolution.why}\n`;
  }
};

/**
 * What the named agent's charter declares it may do.
 *
 * ONE NAME PER LINE, because a capability is a name a person wrote and the
 * caller is bash: a separator would be a character a name could contain, and
 * the shell that reads this splits on newlines already.
 *
 * AN AGENT THAT DECLARED NONE PRINTS NOTHING, and so does one with no charter.
 * The two are the same answer to this question — *nothing bounds this agent* —
 * and they stay distinguishable to the caller through the EXIT CODE, which is
 * what separates them from the charter that could not be read at all.
 *
 * @param repoRoot - the repo root the charter path is relative to.
 * @param name - the agent name, or `''` when nothing named one.
 * @returns the capability names, one per line, or the refusal's reason.
 */
export const capabilities = (repoRoot: string, name: string): { text: string; refused: boolean } => {
  const reading = read(repoRoot, name);
  switch (reading.read) {
    case 'declared':
      return { text: reading.charter.capabilities.map((c) => `${c}\n`).join(''), refused: false };
    case 'unnamed':
    case 'absent':
      return { text: '', refused: false };
    case 'unreadable':
      // THE SAME REFUSAL THE PROMPT QUESTION GIVES, for the same reason: a
      // charter that exists and cannot be believed is a person's typo, and an
      // empty capability list would launch an UNBOUNDED agent silently.
      return { text: `charter '${reading.name}' ${reading.why}\n`, refused: true };
  }
};

/**
 * Print the answer.
 *
 * `--launch` ASKS THE SECOND QUESTION, and it is a flag rather than a
 * positional so the existing contract is untouched: `plot-prompt.mjs <root>
 * [agent]` means exactly what it meant, and `plot-worker-loop.sh:945` — which
 * is vendored into every published package and into checkouts this build does
 * not update — keeps working unchanged.
 *
 * @param argv - the repo root and the agent name, optionally after `--launch`.
 * `--capabilities` asks the second question; without it the prompt line is
 * printed exactly as before, because `plot-worker-loop.sh` parses that line
 * positionally and takes the whole tail as its last field.
 *
 * @param argv - the flag, if any, then the repo root and the agent name.
 * @param write - where the answer goes.
 * @returns the process exit code — 0 resolved, 2 bad arguments, 3 refused.
 */
export const run = (
  argv: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const wantsLaunch = argv[0] === '--launch';
  const asked = argv[0] === '--capabilities';
  const [repoRoot, name = ''] = wantsLaunch || asked ? argv.slice(1) : argv;
  if (repoRoot === undefined || repoRoot === '') {
    process.stderr.write(
      'plot-prompt: usage: plot-prompt.mjs [--launch|--capabilities] <repo-root> [agent-name]\n',
    );
    return 2;
  }
  if (asked) {
    const { text, refused } = capabilities(repoRoot, name);
    // THE REFUSAL GOES TO STDERR, so a caller reading stdout into a list never
    // takes the reason for a capability name. The prompt question can afford
    // one stream because its answer is a fixed three fields; a list cannot.
    if (refused) process.stderr.write(text);
    else write(text);
    return refused ? 3 : 0;
  }
  const line = wantsLaunch ? launch(repoRoot, name) : answer(repoRoot, name);
  write(line);
  // A DISTINCT CODE FOR THE REFUSAL. The caller must not launch on it, and a
  // shell reading only `$?` would otherwise treat an unbelievable charter as a
  // resolved prompt.
  return line.startsWith('refused\t') ? 3 : 0;
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(run(process.argv.slice(2)));
}
