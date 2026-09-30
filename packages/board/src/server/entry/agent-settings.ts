// THROUGH THE NARROW PATH, not the package root. `@plot-pm/domain` re-exports
// every entity and rule, and esbuild bundles what it is given: measured
// 2026-09-03, the root import produced a 334 KB artifact against
// `plot-movable.mjs`'s 1.2 KB.
import { agentSettingsRefusal } from '@plot-pm/domain/rules/agent-settings';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Whether a project's `Agent settings` file may reach a fleet agent — the rule
 * `agentSettingsRefusal` reached without HTTP, for `plot-agent-settings.sh`.
 *
 * ```
 * plot-agent-settings.mjs < .plot/agent-settings.json
 * # exit 0, nothing printed  — the file may travel
 *
 * plot-agent-settings.mjs < gates-off.json
 * enabledPlugins.plot@plot-marketplace	plot@plot-marketplace is the plugin ...
 * # exit 3
 * ```
 *
 * **Its own bundle, for the reason the eight before it give.** `plot-ask.mjs`
 * answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh` — 18.3 s — so a
 * script asking whether one settings file is safe would start a fleet scan to
 * read one file. This entry reads stdin, spawns nothing and opens nothing.
 *
 * **The cost rule permits it.** A shipped bundle answers in about 39 ms, and
 * this runs once per AGENT START rather than once per agent per pass — the case
 * *A Shell Script Asks The Domain* names as the domain's to answer.
 *
 * **THE FILE ARRIVES ON STDIN.** The rule reaches no filesystem, and the one
 * `read` this needs stays in the shell that owns it — the choice
 * `plot-sprint-transition.mjs` and `plot-panel.mjs` both record.
 *
 * **Tab-separated out.** The caller is bash, and JSON would mean a `jq`
 * dependency on a path that has none.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The file may reach an agent. */
  ok: 0,
  /** The input could not be read as JSON — a broken file, not a refused one. */
  unreadable: 2,
  /** The rule refused. */
  refused: 3,
} as const;

/**
 * Judges what arrived on stdin.
 *
 * **An unparseable file is 2 and never 3.** The two answers are different
 * sentences a caller prints — *this file names a key that switches the gates
 * off* against *this file is not JSON* — and collapsing them would report a
 * typo as a deliberate switch-off.
 *
 * @param stdin - the settings file's contents.
 * @param write - where the refusal line goes.
 * @param warn - where a parse failure's reason goes.
 * @returns the process exit code.
 */
export const run = (
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdin);
  } catch (err) {
    warn(`plot-agent-settings: not JSON: ${(err as Error).message}\n`);
    return EXIT.unreadable;
  }

  const refusal = agentSettingsRefusal(parsed);
  if (refusal === undefined) {
    return EXIT.ok;
  }
  write(`${refusal.key}\t${refusal.why}\n`);
  return EXIT.refused;
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
