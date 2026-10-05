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
 * printf 'false\tabc\tdef\tfalse\tok\tnone\t2\t2\t-\t-\tfalse\n' | node plot-branch-state.mjs
 * wip	0	wip
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
 * branches only, and asks again with those readings filled in. The bound is the
 * FLAGGED branches rather than the annotated ones — a `waits:` branch already
 * reading `wip`, `claimed`, `merged` or `deferred` costs nothing — and a plan
 * with no flagged branch pays no second call at all.
 *
 * ## The third field is the branch's own state
 *
 * The rule's answer with no prerequisite considered. A `waiting` or `blocked`
 * state replaces `open` or `unknown`, and the scan emits this field as
 * `own_state` so a reader can tell which one lies underneath.
 */

/**
 * One branch's readings, as the scan writes them.
 *
 * Eleven tab-separated fields, and every one is spelled rather than implied:
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
 * | `waitsBranch` | every prerequisite, comma-separated, or `-` where the plan names none |
 * | `waitsPr` | the prerequisites' PR words, comma-separated and in the same order, `?` where none was asked |
 * | `prListComplete` | `true` where the host's PR list held every PR, anything else otherwise |
 *
 * **TWO PARALLEL COLUMNS, NOT ONE PER PREREQUISITE.** The scan still asks one
 * round trip per BRANCH, not per prerequisite, so field 10 is `?` for the whole
 * branch or a reading for every name field 9 lists — never a mix. A name list
 * and a state list of different lengths is a defect in the scan, and this
 * refuses it rather than guessing a zip, the same way {@link countFrom} refuses
 * an unparsable count rather than coercing it.
 *
 * **`?` IS NOT A READING AND `-` IS.** They were one marker until the first CI
 * run of this bundle, and collapsing them is a defect with a direction: the
 * scan's `host_pr_state` answers `-` for an unreachable host, which the rule
 * reads as `unreadable` and makes `waiting` — *silence is not evidence, in
 * either direction*. An unauthenticated checkout answers `-` for EVERY
 * prerequisite, so a `-` that meant *not asked* reported every waiting branch
 * as `open` and would hand it to `--next`. Measured 2026-09-07 in CI, which
 * runs the corpus with no token: one branch, `adapter=waiting production=open`.
 *
 * So `?` alone means the shell has not put the question, and only `?` makes
 * `waits` empty and raises the flag that asks it to. `-` also gives an empty
 * `waits`, because the plan names nothing to ask about — the two are kept
 * apart by {@link ParsedLine.waitsBranch}, which the rule's own
 * `REPLACEABLE_BY_PREREQUISITE` flag depends on to tell *nothing declared* from
 * *declared, not yet read*.
 */
const FIELDS = 11;

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
 * One parsed line: the readings, and the prerequisites the plan named.
 *
 * The names are kept BESIDE the readings rather than inside them, because the
 * rule's `waits` is `[]` for two different lines — a plan naming no
 * prerequisite, and a plan naming some whose state has not been read. Only the
 * second is worth a host round trip, and the flag {@link answer} reports must
 * tell them apart.
 */
interface ParsedLine {
  /** What the rule takes. */
  readings: BranchReadings;
  /** Every prerequisite the plan named, empty where it named none. */
  waitsBranch: readonly string[];
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
        deferred, refTip, mainTip, subject, reach, pr, ahead, real, waitsBranch, waitsPr, listComplete,
      ] = fields as [
        string, string, string, string, string, string, string, string, string, string, string,
      ];
      const names = waitsBranch === '-' ? [] : waitsBranch.split(',');
      // `?` IS A SINGLE FLAG FOR THE WHOLE BRANCH, NEVER PER-ITEM: the scan asks
      // one round trip per branch, so a state list either answers every named
      // prerequisite or answers none of them.
      const states = waitsPr === '?' ? [] : waitsPr.split(',');
      if (waitsPr !== '?' && names.length !== states.length) {
        throw new Error(
          `line ${i + 1}: waitsBranch names ${names.length} prerequisite(s) but waitsPr carries ${states.length}: '${waitsBranch}' / '${waitsPr}'`,
        );
      }
      const readings: BranchReadings = {
        deferredByPlan: deferred === 'true',
        refTip: refTip === '-' ? null : refTip,
        mainTip: mainTip === '-' ? null : mainTip,
        mergeSubjectFound: subject === 'true',
        hostReach: reachFrom(reach),
        pr: prFrom(pr),
        prListComplete: listComplete === 'true',
        commitsAhead: countFrom(ahead, i + 1, 'commitsAhead'),
        realCommitsAhead: countFrom(real, i + 1, 'realCommitsAhead'),
        waits: waitsPr === '?' ? [] : names.map((branch, index) => ({ branch, pr: prFrom(states[index] as string) })),
      };
      return { readings, waitsBranch: names };
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
 * @returns one `state<TAB>needsPrerequisite<TAB>ownState` line per branch,
 *   newline-terminated. The third column is `branchState` asked again with no
 *   prerequisite readings.
 */
export const answer = (text: string): string =>
  parsedFrom(text)
    .map(({ readings, waitsBranch }) => {
      const state = branchState(readings);
      const needs =
        waitsBranch.length > 0
        && readings.waits.length === 0
        && REPLACEABLE_BY_PREREQUISITE.includes(state)
          ? '1'
          : '0';
      const own = branchState({ ...readings, waits: [] });
      return `${state}\t${needs}\t${own}\n`;
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
