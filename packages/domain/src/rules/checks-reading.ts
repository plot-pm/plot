import type { Checks, Mergeability } from '../entities/pr.js';

/**
 * What a reader sees for a PR's build, and whether it is worth saying at all.
 *
 * The defect this answers, measured 2026-09-07: `ChecksSchema` has carried
 * `unknown` since it was written, `plot-host.sh pr-list --rich` branches on
 * backend and Jenkins to produce it, and `fleet.ts`'s `PrRecord` holds it — and
 * `CardPrSchema` carries `number` and `url` alone, so every plan card drops it
 * at the wire. A PR with no CI configured and a PR whose CI could not be reached
 * render identically: blank.
 *
 * `none` MEANS *this PR has no CI*. `unknown` MEANS *we could not find out*.
 * On a GitHub repo that difference is academic. On a Jenkins team, where the
 * board reaches `gh` alone, every PR is `unknown` and the board shows what looks
 * like a fleet running no CI at all.
 *
 * The same rule the supervisor badge already applies (`supervisor-reading.ts`)
 * and `plot-board-probe.sh` applies to auth: a reading that could not be taken
 * must render as neither of the answers it might have had.
 */

/**
 * Whether the branch merges cleanly — the reading that DISAMBIGUATES `checks`.
 *
 * GitHub starts no workflow for a PR that does not merge, so a conflicting PR
 * reports an empty rollup: `checks: 'none'`, indistinguishable from a bot PR
 * whose run waits for a human to approve it. Carrying one without the other
 * ships a known ambiguity, which is why this travels with the checks reading
 * rather than beside it.
 *
 * `unknown` on every host that cannot answer, and on every payload written
 * before the field existed. A consumer must not read it as clean.
 */
export interface ChecksReadings {
  /** The build, summarized onto the PR. */
  checks: Checks;
  /** Whether the branch merges cleanly — see {@link ChecksReadings}. */
  mergeable: Mergeability;
}

/**
 * How loudly the board should say what it read.
 *
 * - `quiet` — nothing outstanding, or nothing worth a reader's attention:
 *   `green`, and `none` on a PR that merges cleanly.
 * - `note` — worth saying and never an alarm. `unknown` is the case this rule
 *   exists for: the board's own inability to ask is not a fact about the build.
 *   `pending` joins it — a machine is working, which is information rather than
 *   a finding.
 * - `warn` — a person must act. `failing`, and `none` where the branch
 *   conflicts, because there the empty rollup is a CONSEQUENCE of a fault.
 */
export type ChecksProminence = 'quiet' | 'note' | 'warn';

/**
 * What the board renders about a PR's build.
 *
 * The state, its prominence and its two pieces of text travel together, so a
 * caller cannot pair one reading's word with another's styling. That pairing is
 * what a `.tsx` would re-derive, and re-deriving it is how a view state comes to
 * be testable only by rendering it.
 */
export interface ChecksVerdict {
  /** Which of the five states was read. */
  state: Checks;
  /** How loudly to say it. */
  prominence: ChecksProminence;
  /** Whether it is worth saying at all. */
  shown: boolean;
  /** The label a badge prints. */
  label: string;
  /** The sentence a title attribute carries. */
  detail: string;
}

/**
 * How loudly to say it — the rule that reads the mergeability beside the checks.
 *
 * `none` IS THE ONE STATE WHOSE PROMINENCE DEPENDS ON THE SECOND READING. An
 * empty rollup on a clean branch is a fact about the repository: no workflow is
 * configured, and nothing is wrong. The same empty rollup on a conflicting
 * branch is a symptom — GitHub declined to start a run — and a reader who sees
 * `no checks` there is told the truth about the symptom and nothing about the
 * cause.
 *
 * @param readings - the build and the mergeability, read together.
 * @returns quiet, a note, or a warning.
 */
export const checksProminence = (readings: ChecksReadings): ChecksProminence => {
  if (readings.checks === 'failing') return 'warn';
  if (readings.checks === 'unknown') return 'note';
  if (readings.checks === 'pending') return 'note';
  if (readings.checks === 'none') return readings.mergeable === 'conflicting' ? 'warn' : 'quiet';
  return 'quiet';
};

/**
 * Whether the board says anything at all about this PR's build.
 *
 * SILENT WHEN THE NEWS IS GOOD, the shape the supervisor badge beside it
 * already uses. A PR whose checks are green needs no annotation; only the
 * absence of an answer, or an answer worth acting on, is a finding.
 *
 * `none` ON A CLEAN BRANCH IS SHOWN, and that is the plan's central rule. It
 * is quiet — no colour, no alarm — but it must be VISIBLE, because `none` and
 * `unknown` rendering the same is the whole defect. Two states that a reader
 * cannot tell apart are one state, whatever the payload carries.
 *
 * @param readings - the build and the mergeability, read together.
 * @returns true when there is something worth saying.
 */
export const checksShown = (readings: ChecksReadings): boolean => readings.checks !== 'green';

/**
 * The whole verdict — state, prominence, and the two pieces of text.
 *
 * ONE CALL RATHER THAN THREE, so a renderer takes the word and the styling from
 * one reading of one set of facts.
 *
 * THE `unknown` SENTENCE NAMES THE BOARD RATHER THAN THE BUILD. *Could not be
 * asked* is a fact about this reading, and phrasing it as a fact about the PR is
 * exactly the confusion the fifth state exists to prevent. The `none` sentence
 * names the repository for the same reason: it is a fact about what is
 * configured, not about what happened.
 *
 * @param readings - the build and the mergeability, read together.
 * @returns what to render, and whether to render it.
 */
export const checksVerdict = (readings: ChecksReadings): ChecksVerdict => {
  const prominence = checksProminence(readings);
  const shown = checksShown(readings);
  if (readings.checks === 'green') {
    return {
      state: 'green',
      prominence,
      shown,
      label: 'checks green',
      detail: 'Every check on this pull request concluded successfully.',
    };
  }
  if (readings.checks === 'failing') {
    return {
      state: 'failing',
      prominence,
      shown,
      label: 'checks failing',
      detail: 'A check on this pull request failed, or one is waiting for a person to approve the run.',
    };
  }
  if (readings.checks === 'pending') {
    return {
      state: 'pending',
      prominence,
      shown,
      label: 'checks running',
      detail: 'A check on this pull request is queued or running. A machine is the blocker.',
    };
  }
  if (readings.checks === 'unknown') {
    return {
      state: 'unknown',
      prominence,
      shown,
      label: 'checks not asked',
      detail:
        'The board could not find out what this pull request’s checks say, so no build state was ever established. This is not the same fact as the pull request having no checks.',
    };
  }
  return {
    state: 'none',
    prominence,
    shown,
    label: readings.mergeable === 'conflicting' ? 'no checks — conflicts' : 'no checks',
    detail:
      readings.mergeable === 'conflicting'
        ? 'This pull request has no checks because the branch does not merge cleanly, so the host started no run. Rebase it and the checks will follow.'
        : 'This pull request has no checks. No workflow ran against it, and the host was able to say so.',
  };
};

/**
 * Whether the CONNECTOR itself could not be asked, rather than one PR.
 *
 * ONE UNREACHABLE SERVICE IS NOT SEVENTY-TWO FINDINGS. A per-PR `unknown` means
 * *this pull request*; a service-level refusal means *this stack*, and a reader
 * must be able to tell which they are looking at. A board that annotates every
 * row of a Jenkins team teaches its reader to ignore the annotation, which is
 * the same outcome as not rendering it.
 *
 * CONCLUDED FROM THE ROWS, not read from a field, and that is deliberate: the
 * board learns a connector cannot answer by every answer being `unknown`, which
 * is the same evidence `hostCannotReportCi` uses on the fleet side. There is no
 * separate signal to read — `plot-host.sh` reports per PR, and a host that
 * cannot report checks reports `unknown` for all of them.
 *
 * THE EMPTY SET IS NOT A REFUSAL. With no PRs to read, every one of them being
 * `unknown` is vacuously true, and a rule that returned `true` there would put a
 * connector warning on a board that has simply not fetched yet. `hostAnswer`
 * answers that earlier, weaker question on the fleet side and outranks this one
 * for the same reason.
 *
 * @param readings - every PR reading the board holds.
 * @returns true when there are readings and every one of them is `unknown`.
 */
export const checksUnaskable = (readings: readonly ChecksReadings[]): boolean =>
  readings.length > 0 && readings.every((one) => one.checks === 'unknown');

/**
 * What the board says ONCE when the connector itself could not be asked.
 *
 * A sentence rather than a badge per row. It names the board and the stack —
 * *this host cannot report* — because the fact belongs to the connector, and
 * phrasing it as a fact about the pull requests is the confusion this rule
 * exists to prevent.
 */
export const CHECKS_UNASKABLE_NOTE =
  'The host cannot report check states, so no build is known for any pull request here. This is a fact about the connector, not about the work.';

/**
 * How a CI system is named to a reader.
 *
 * THE DOMAIN LEARNS NO VENDOR, and this function is where that was nearly lost.
 * It first held `github-actions -> GitHub Actions` and `jenkins -> Jenkins`, and
 * CI's *domain names no vendor* gate refused it — correctly, and for the reason
 * `rules/stack.ts` already states: a rule that knows which systems exist needs
 * editing when the third one arrives, which is the property `BuildSystem` and
 * `HostBackend` were opened to strings to keep.
 *
 * SO THE CONNECTOR SUPPLIES THE NAME. Each `BuildPort` implementation knows
 * what its vendor is called — `build-actions.ts` says `GitHub Actions`,
 * `build-jenkins.ts` says `Jenkins` — and this only tidies whatever arrives.
 * A third CI system is a file under `adapters/`, with no edit here.
 *
 * @param name - the display name the connector supplies, or the declared key
 *   where no connector answered.
 * @returns the name to show a reader, trimmed; `''` where nothing was supplied.
 */
export const ciDisplayName = (name: string): string => name.trim();

export const checksUnaskableNote = (system: string): string => {
  const name = ciDisplayName(system);
  return name === ''
    ? CHECKS_UNASKABLE_NOTE
    : `${name} reported no check state for any pull request here. This is a fact about the connector, not about the work.`;
};
