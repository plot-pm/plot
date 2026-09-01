import { isClaimable, sliceVerdicts, type SliceReadings } from '@plot-pm/domain/rules/eligible';
import type { BranchState } from '@plot-pm/domain';

/**
 * The `node` entry point `plot-fleet-scan.sh` runs, once per plan.
 *
 * ```
 * printf '3\tapproved\topen|wip\n0\tapproved\tmerged\n' | node plot-verdicts.mjs
 * eligible	10
 * complete	0
 * ```
 *
 * **A THIRD artifact, and the reason is not size.** `plot-ask.mjs` answers
 * `board` and `fleet` by RUNNING `plot-fleet-scan.sh`. A scan that asked it for
 * its own verdicts would be an artifact calling the script that called it — not
 * a loop today, because these questions read no estate, but a re-entrancy
 * anybody adding a field to that answer would have to keep in mind. Separated,
 * the hazard cannot be constructed: this bundle spawns nothing and reads
 * nothing.
 *
 * **Size is the second reason and it is measured.** This runs inside the scan's
 * per-plan loop on a 5-second pulse path, once per plan against ~40 plans here,
 * so the artifact's import cost is paid per plan. Measured 2026-09-01:
 * `plot-ask.mjs` is 461 KB of board, this is **1 KB**.
 *
 * **It imports the rule directly rather than through the barrel**, and that is
 * what makes the number true. `@plot-pm/domain`'s index re-exports every entity,
 * and the entities carry `zod` schemas — through the barrel this artifact built
 * at **323 KB**, 99% of it a validator no line here calls. The subpath export
 * exists for exactly this: an entry point that wants one rule takes one rule.
 *
 * **Both questions in one answer, because they are one call's worth.**
 * `sliceVerdict` says what the slice is; `isClaimable` says which of its
 * branches a worker may take, and it needs the verdict. Asking them separately
 * would mean either two processes per plan or the caller re-deciding the
 * conjunction — which is the second implementation this adoption removes.
 *
 * **Tab-separated in, tab-separated out.** The caller is bash inside a loop
 * that already speaks `IFS=$'\t' read`, and a JSON round trip there would mean
 * `jq` per plan — a second process to avoid a second format.
 */

/** One slice's readings, with the states of the branches it holds. */
export interface SliceLine extends SliceReadings {
  /** The branches' measured states, in the order the caller will render them. */
  states: string[];
}

/**
 * Parse one slice per line: `outstanding<TAB>phase<TAB>state|state|...`.
 *
 * A line that does not parse is NOT skipped. An unreadable count would silently
 * become `0` and read `complete` — the verdict that says work has landed — so a
 * malformed line refuses the whole batch rather than inventing the most
 * permissive answer for it. A slice with no branches is spelled by an empty
 * third field and is legitimate; a MISSING third field is not.
 *
 * @param text the stdin document, one slice per line
 * @returns the slices in order
 * @throws when any non-empty line is not `<count><TAB><phase><TAB><states>`
 */
export const slicesFrom = (text: string): SliceLine[] =>
  text
    .split('\n')
    .filter((line) => line !== '')
    .map((line, i) => {
      const [count, phase, states] = line.split('\t');
      const outstanding = Number(count);
      if (!Number.isInteger(outstanding) || outstanding < 0
        || phase === undefined || states === undefined) {
        throw new Error(
          `line ${i + 1}: expected '<count>\\t<phase>\\t<states>', got '${line}'`,
        );
      }
      return { outstanding, phase, states: states === '' ? [] : states.split('|') };
    });

/**
 * Decide every slice of one plan, and every branch within it.
 *
 * The claimable flags are a digit per branch in the order given — `1` where a
 * worker may take it. A digit string rather than a list of names because the
 * caller is iterating those branches anyway and needs to know, for each one in
 * turn, whether this is the one to offer.
 *
 * @param text the stdin document, one slice per line
 * @returns one `verdict<TAB>flags` line per slice, newline-terminated
 */
export const answer = (text: string): string => {
  const slices = slicesFrom(text);
  const verdicts = sliceVerdicts(slices);
  return slices
    .map((slice, i) => {
      const verdict = verdicts[i]!;
      const flags = slice.states
        .map((state) => (isClaimable(verdict, state as BranchState) ? '1' : '0'))
        .join('');
      return `${verdict}\t${flags}\n`;
    })
    .join('');
};

/**
 * Read stdin, print the answer.
 *
 * @param text the whole of stdin
 * @param write where the answer goes
 * @returns the process exit code — 0 answered, 2 unreadable input
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  try {
    write(answer(text));
    return 0;
  } catch (err) {
    process.stderr.write(`plot-verdicts: ${(err as Error).message}\n`);
    return 2;
  }
};

// Only when RUN, never when imported.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
