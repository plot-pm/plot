// THROUGH THE NARROW PATH, not the package root. `@plot-pm/domain` re-exports
// every entity and rule, and esbuild bundles what it is given: measured
// 2026-09-03, the root import produced a 334 KB artifact against
// `plot-movable.mjs`'s 1.2 KB. The harness table is imported by its own file
// rather than through `adapters/index.js`, which pulls the whole adapter barrel.
import { HARNESS_LIMIT_LINES } from '@plot-pm/domain/adapters/harness/limit-lines';
import { promptExit, type PromptExit } from '@plot-pm/domain/rules/prompt-exit';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * What one prompt exit was — `promptExit` reached without HTTP, for
 * `plot-worker-loop.sh`.
 *
 * ```
 * plot-prompt-exit.mjs 1 claude 1790863200 28800 3 0 0 < tail-200.txt
 * wait	1790868000	2026-10-01T15:20:00.000Z	You've hit your session limit · resets 5:20pm (Europe/Zurich)
 *
 * plot-prompt-exit.mjs 1 claude 1790863200 1800 3 0 0 < tail-200.txt
 * end-limited	1790868000	2026-10-01T15:20:00.000Z	past-bound	You've hit your …
 *
 * plot-prompt-exit.mjs 1 claude 1790863200 28800 3 0 0 < other-failure.txt
 * unstarted
 * ```
 *
 * **It joins the table to the rule and decides nothing.** The rule takes the
 * patterns as an argument so it names no vendor; the table is keyed by harness
 * name; this entry is the one place that looks one up. A harness the table does
 * not know supplies no patterns, and every exit from it answers by status
 * exactly as it did before this bundle existed.
 *
 * **Its own bundle, for the reason the nine before it give.** `plot-ask.mjs`
 * answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh` — 18.3 s — so a
 * loop asking what one exit was would start a fleet scan to read 200 lines.
 * This entry reads stdin, spawns nothing and opens nothing.
 *
 * **The cost rule permits it, and the frequency is the argument.**
 * `docs/shell-and-domain.md` §1 names `plot-worker-loop.sh` as the script that
 * duplicates a rule, because a hop on its idle pass is paid by every agent on
 * every pass. A prompt exit is not an idle pass: it happens once per prompt,
 * and a prompt runs for minutes or hours, so one `node` start adds nothing
 * measurable. A shell copy would need a corpus test to hold the pair together
 * for no saved cost.
 *
 * **THE OUTPUT ARRIVES ON STDIN.** The rule reaches no filesystem, and the one
 * read stays in the shell that owns it — the choice `plot-agent-settings.mjs`,
 * `plot-sprint-transition.mjs` and `plot-panel.mjs` each record.
 *
 * **Tab-separated out, and every instant twice.** The caller is bash, so JSON
 * would mean a `jq` dependency on a path that has none. The reset goes out as
 * epoch seconds AND as UTC ISO text, so the loop, the monitor and
 * `plot-fleetctl.sh` compare integers and never parse a date.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** An answer was written. */
  ok: 0,
  /** The arguments could not be read. */
  unreadable: 2,
} as const;

/**
 * The answer as one tab-separated line.
 *
 * `wait` carries the reset and the limit line; `end-limited` carries the reset
 * — or `unknown` and `-` where none could be read — then the cause and the
 * line. **The cause sits before the line** because a limit line may itself
 * contain anything, so a field after it could not be found by position.
 * `unstarted` and `ran` carry nothing: they are today's two paths, and a field
 * would invent a reading.
 */
export const line = (answer: PromptExit): string => {
  if (answer.answer === 'wait') {
    return `wait\t${answer.reset.epoch}\t${answer.reset.iso}\t${answer.line}\n`;
  }
  if (answer.answer === 'end-limited') {
    const epoch = answer.reset ? String(answer.reset.epoch) : 'unknown';
    const iso = answer.reset ? answer.reset.iso : '-';
    return `end-limited\t${epoch}\t${iso}\t${answer.cause}\t${answer.line}\n`;
  }
  return `${answer.answer}\n`;
};

/**
 * Judges one prompt exit from the seven readings and the output.
 *
 * **The loop passes all seven on every exit**, including an exit from a prompt
 * that never waited: there the wait flag is `0` and the commit count is `0`,
 * and the rule reads neither the run time nor the commit count, so such an exit
 * can never answer `no-progress`.
 *
 * @param argv - status, harness, now, bound, ran, wait flag, commits.
 * @param stdin - the last lines of the prompt's output.
 * @param write - where the answer goes.
 * @param warn - where a usage error goes.
 * @returns the process exit code.
 */
export const run = (
  argv: readonly string[],
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  const [rawStatus, harness, rawNow, rawBound, rawRan, rawWaited, rawCommits] = argv;

  if (argv.length < 7) {
    warn(
      'plot-prompt-exit: usage: <status> <harness> <now> <bound-seconds> <ran-seconds> <after-wait> <commits-since-wait>\n',
    );
    return EXIT.unreadable;
  }

  const numbers = [rawStatus, rawNow, rawBound, rawRan, rawWaited, rawCommits].map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) {
    // REFUSED RATHER THAN DEFAULTED. A bound read as 0 would disable the wait
    // cap and a status read as 0 would take the `ran` path, so a misread
    // argument must not become a reading the loop acts on; the loop reads any
    // non-answer as today's path.
    warn('plot-prompt-exit: every argument but the harness must be a number\n');
    return EXIT.unreadable;
  }

  const [status, now, boundSeconds, ranSeconds, waited, commitsSinceWait] = numbers;

  write(
    line(
      promptExit(
        {
          status,
          output: stdin,
          now,
          boundSeconds,
          ranSeconds,
          afterWait: waited !== 0,
          commitsSinceWait,
        },
        HARNESS_LIMIT_LINES[harness],
      ),
    ),
  );
  return EXIT.ok;
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
  process.exit(run(process.argv.slice(2), Buffer.concat(chunks).toString('utf8')));
}
