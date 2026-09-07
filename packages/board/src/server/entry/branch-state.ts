import {
  branchState,
  REPLACEABLE_BY_PREREQUISITE,
  type BranchReadings,
  type HostReach,
  type PrReading,
} from '@plot-pm/domain/rules/branch-state';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-fleet-scan.sh` runs, once per plan.
 *
 * ```
 * printf 'false\tabc\tdef\tfalse\tok\tnone\t2\t2\t-\t-\n' | node plot-branch-state.mjs
 * wip	0
 * ```
 *
 * **An ELEVENTH artifact, for the reason the third through tenth ones give.**
 * `plot-ask.mjs` answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh`,
 * so the scan asking it for its own branch states would be an artifact calling
 * the script that called it. This bundle spawns nothing and reads nothing.
 *
 * **It imports the rule directly rather than through the barrel.**
 * `@plot-pm/domain`'s index re-exports every entity and the entities carry
 * `zod` schemas — ~320 KB of validator no line here calls. The subpath export
 * exists for exactly this.
 *
 * **ONE CALL PER PLAN, not per branch.** The scan walks ~40 plans on a 5-second
 * pulse and each holds several branches, so a process per branch would put the
 * per-branch tail back that `real_commits_beyond_main` was written to remove.
 * The whole plan's readings go in and one state per line comes out.
 *
 * **Tab-separated in, tab-separated out**, for the reason `verdicts.ts` gives:
 * the caller is bash inside a loop that already speaks `IFS=$'\t' read`, and a
 * JSON round trip there would mean `jq` per plan.
 *
 * ## The second field is what keeps the host call lazy
 *
 * `waits_pr_state()` costs a host round trip, and the scan spends it only where a
 * prerequisite could change the answer. That condition IS the rule's
 * precedence — `REPLACEABLE_BY_PREREQUISITE`, `open` and `unknown` — so
 * copying it into a shell `case` would put back the duplicate this slice
 * removes, in the one place a reader would never think to look for it.
 *
 * So the answer carries it: `1` where a prerequisite would replace this state
 * and `0` where it would not. The shell reads the prerequisite for the flagged
 * branches only, and asks again with those readings filled in. On an estate
 * with no live `waits:` annotation — measured 2026-09-07, this one — the second
 * call never happens.
 */

/**
 * One branch's readings, as the scan writes them.
 *
 * Ten tab-separated fields, and every one is spelled rather than implied:
 * `-` is the absent marker the scan already uses everywhere a middle column may
 * be empty, because a run of tabs collapses into one separator under bash's
 * `read`.
 *
 * | field | spelling |
 * |---|---|
 * | `deferredByPlan` | `true` or anything else |
 * | `refTip` | the oid, or `-` for no remote ref |
 * | `mainTip` | the oid, or `-` where it cannot be read |
 * | `mergeSubjectFound` | `true` or anything else |
 * | `hostReach` | `ok`, `unasked`, `throttled`, `secondary`, `failed` |
 * | `pr` | `OPEN`, `MERGED`, `CLOSED`, `NONE`, `-` |
 * | `commitsAhead` | a non-negative integer |
 * | `realCommitsAhead` | a non-negative integer |
 * | `waitsBranch` | the prerequisite, or `-` where the plan names none |
 * | `waitsPr` | the prerequisite's PR word, or `-` where it was not read |
 *
 * **`-` IN `waitsPr` MEANS NOT YET READ, and it is not a reading.** A branch
 * that names a prerequisite whose state the shell has not fetched carries
 * `waits: null` into the rule, so the branch's own readings stand — which is
 * exactly what the flagged answer then asks the shell to correct. The scan's
 * unreadable-host marker reaches the rule as `unreadable` through the `pr`
 * column, which IS a reading and means something different.
 */
const FIELDS = 10;

/**
 * The scan's PR words, in the rule's vocabulary.
 *
 * `NONE` and `-` are the two absences the scan keeps apart and the rule keeps
 * apart: the host answered that no pull request exists, against the host not
 * having answered at all. Collapsing them is the failure `host_pr_state`'s own
 * comment records, so the mapping is explicit rather than a default.
 */
const prFrom = (word: string): PrReading => {
  if (word === 'OPEN' || word === 'MERGED' || word === 'CLOSED') return word;
  if (word === 'NONE') return 'none';
  return 'unreadable';
};

/**
 * The scan's `HOST_VERDICT`, narrowed to the reach the rule takes.
 *
 * An unrecognised word reads `failed` rather than `ok`. The scan and this
 * bundle ship together, so a mismatch means the artifact is stale — and a stale
 * artifact answering `ok` would claim evidence it does not hold, while `failed`
 * answers `unknown`, which is outstanding exactly as `open` is and hands the
 * branch to nobody.
 */
const reachFrom = (word: string): HostReach => {
  if (
    word === 'ok' || word === 'unasked' || word === 'throttled'
    || word === 'secondary' || word === 'failed'
  ) {
    return word;
  }
  return 'failed';
};

/**
 * A count the scan measured, refusing anything that is not one.
 *
 * NOT coerced to zero. `commitsAhead` of `0` is the reading that sends a branch
 * down the tip-comparison arm and out as `merged`, so an unparsable count
 * silently becoming zero would report unstarted work as landed and settle its
 * wave.
 *
 * @throws when the field is not a non-negative integer.
 */
const countFrom = (word: string, line: number, name: string): number => {
  const n = Number(word);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`line ${line}: ${name} is not a count: '${word}'`);
  }
  return n;
};

/**
 * Parse one branch per line into the readings the rule takes.
 *
 * A line that does not parse is NOT skipped. A dropped line would shift every
 * state after it onto the wrong branch, and the caller reads the answer
 * positionally — so a malformed line refuses the whole batch.
 *
 * @param text the stdin document, one branch per line
 * @returns the branches' readings, in order
 * @throws when any non-empty line is not {@link FIELDS} tab-separated fields
 */
export const readingsFrom = (text: string): BranchReadings[] =>
  parsedFrom(text).map((entry) => entry.readings);

/**
 * One parsed line: the readings, and the prerequisite the plan named.
 *
 * The name is kept BESIDE the readings rather than inside them, because the
 * rule's `waits` is `null` for two different lines — a plan naming no
 * prerequisite, and a plan naming one whose state has not been read. Only the
 * second is worth a host round trip, and the flag {@link answer} reports must
 * tell them apart.
 */
interface ParsedLine {
  /** What the rule takes. */
  readings: BranchReadings;
  /** The prerequisite the plan named, or `''` where it named none. */
  waitsBranch: string;
}

/**
 * Parse one branch per line, keeping the prerequisite's name beside the
 * readings.
 *
 * @param text the stdin document, one branch per line
 * @returns the parsed lines, in order
 * @throws when any non-empty line is not {@link FIELDS} tab-separated fields
 */
const parsedFrom = (text: string): ParsedLine[] =>
  text
    .split('\n')
    .filter((line) => line !== '')
    .map((line, i) => {
      const fields = line.split('\t');
      if (fields.length !== FIELDS) {
        throw new Error(
          `line ${i + 1}: expected ${FIELDS} tab-separated fields, got ${fields.length}`,
        );
      }
      const [
        deferred, refTip, mainTip, subject, reach, pr, ahead, real, waitsBranch, waitsPr,
      ] = fields as [
        string, string, string, string, string, string, string, string, string, string,
      ];
      const readings: BranchReadings = {
        deferredByPlan: deferred === 'true',
        refTip: refTip === '-' ? null : refTip,
        mainTip: mainTip === '-' ? null : mainTip,
        mergeSubjectFound: subject === 'true',
        hostReach: reachFrom(reach),
        pr: prFrom(pr),
        commitsAhead: countFrom(ahead, i + 1, 'commitsAhead'),
        realCommitsAhead: countFrom(real, i + 1, 'realCommitsAhead'),
        waits:
          waitsBranch === '-' || waitsPr === '-'
            ? null
            : { branch: waitsBranch, pr: prFrom(waitsPr) },
      };
      return { readings, waitsBranch: waitsBranch === '-' ? '' : waitsBranch };
    });

/**
 * Decide every branch of one plan.
 *
 * The second column says whether reading a prerequisite would change the state
 * just given — the rule's own `REPLACEABLE_BY_PREREQUISITE`, reported rather
 * than re-derived by the caller. All three conditions must hold: the plan NAMES
 * a prerequisite, its reading has NOT arrived, and the state is one the
 * prerequisite may replace. So a branch with no prerequisite is never asked
 * about, and one that already carries its prerequisite's state is never asked
 * about twice.
 *
 * @param text the stdin document, one branch per line
 * @returns one `state<TAB>needsPrerequisite` line per branch, newline-terminated
 */
export const answer = (text: string): string =>
  parsedFrom(text)
    .map(({ readings, waitsBranch }) => {
      const state = branchState(readings);
      const needs =
        waitsBranch !== ''
        && readings.waits === null
        && REPLACEABLE_BY_PREREQUISITE.includes(state)
          ? '1'
          : '0';
      return `${state}\t${needs}\n`;
    })
    .join('');

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
    process.stderr.write(`plot-branch-state: ${(err as Error).message}\n`);
    return 2;
  }
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
