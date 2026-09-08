/**
 * What an adoption probe's readings propose — the thresholds setup decides by.
 *
 * The defect this answers, measured 2026-09-08. Two collectors carried seven
 * thresholds between them, each a decision no test could reach:
 * `plot-board-probe.sh` decided that a Node major of 20 was enough, seven lines
 * below a header reading *"It DECIDES NOTHING"*; `plot-detect-repo.sh` decided
 * that two matching subjects make a commit style, two occurrences make a ticket
 * scheme, and three German words make a German repository.
 *
 * The Node floor had three answers on that estate — a literal 20 in the probe,
 * the major `.nvmrc` pins in `plot-fleetctl.sh`, and nothing at all in
 * `plot-boardctl.sh` — and the probe's own answer had no reader.
 *
 * A collector reports a reading; this decides what the reading proposes. The
 * split follows the layering rule from the other end: the probes reach the
 * machine and cannot move inward, so the judgement moves out of them instead.
 *
 * EVERY PROPOSAL CARRIES ITS EVIDENCE. A bare word cannot be confirmed or
 * rejected in one read, and both skills print the count beside the proposal for
 * that reason — *"`QUACDS` in 38 of 80 subjects"* rather than *"jira"*.
 */

/**
 * How many subjects match each commit notation, out of the sample read.
 *
 * Counts rather than a style, because which count wins is what this file
 * decides. `plot-detect-repo.sh` computed the style itself until 2026-09-08 and
 * the thresholds lived in its `if` chain, where nothing could assert them.
 */
export interface CommitStyleCounts {
  /** Subjects shaped `F: fix the thing`. */
  colon: number;
  /** Subjects shaped `F - fix the thing`. */
  dash: number;
  /** Subjects shaped `feat(scope): a thing`. */
  conventional: number;
}

/** A commit notation a repository can be proposed to use. */
export type CommitStyle = 'arlo-colon' | 'arlo-dash' | 'conventional';

/** A content language a hub doc can be proposed to be written in. */
export type ContentLanguage = 'de' | 'en';

/**
 * The readings `plot-detect-repo.sh` and `plot-board-probe.sh` collect.
 *
 * TAKEN AS VALUES, never through a port. The probes reach the machine; this
 * takes what they read. Every field is what a collector measured, and none is
 * what a collector concluded.
 */
export interface StackReadings {
  /**
   * `node --version` output, or `''` where no `node` is on PATH.
   *
   * The raw string, `v24.20.0` and all, because parsing it is a decision about
   * what counts as a version and belongs here rather than in the shell.
   */
  nodeVersion: string;
  /**
   * The major version the repository pins, or `null` where it pins none.
   *
   * From `.nvmrc`, which is the one place a repository states it. The two
   * `engines` blocks say `>=24`, which is a floor rather than a pin, and a
   * literal here would be the fourth answer to a question that already had
   * three.
   */
  nodeFloor: number | null;
  /** How many recent subjects match each notation. */
  commitStyleCounts: CommitStyleCounts;
  /** The most frequent ticket prefix in the sample, or `''` where none recurs. */
  ticketPrefix: string;
  /** How many subjects carried {@link StackReadings.ticketPrefix}. */
  ticketPrefixCount: number;
  /** How many subjects were read for the two counts above. */
  subjectsRead: number;
  /** How many German words the hub docs' sample carried. */
  germanWordCount: number;
  /** Whether any hub doc was found to sample at all. */
  hasHubDoc: boolean;
}

/** What the readings propose about the Node on this machine. */
export interface NodeProposal {
  /** The major version found, or `null` where none could be read. */
  major: number | null;
  /**
   * Whether that major meets the floor.
   *
   * `null` where either side is unknown — no `node` on PATH, an unparseable
   * version, or a repository pinning nothing. It is the *cannot verify* answer
   * `plot-board-probe.sh` already takes for auth, and it must never read as
   * supported: a green light nobody can act on is the worst way to be wrong.
   */
  supported: boolean | null;
  /** The floor the answer was taken against, or `null` where none was pinned. */
  floor: number | null;
}

/** What the readings propose about a repository's commit notation. */
export interface CommitStyleProposal {
  /** The notation proposed, or `null` where no count reached the threshold. */
  style: CommitStyle | null;
  /** How many subjects carried it — the evidence the proposal travels with. */
  matched: number;
  /** How many subjects were read. */
  outOf: number;
}

/** What the readings propose about a repository's ticket scheme. */
export interface TicketProposal {
  /** The prefix proposed, or `null` where none recurred. */
  prefix: string | null;
  /** How many subjects carried it. */
  matched: number;
  /** How many subjects were read. */
  outOf: number;
}

/** What the readings propose about a repository's content language. */
export interface LanguageProposal {
  /** The language proposed, or `null` where there was no doc to read. */
  language: ContentLanguage | null;
  /** How many German words the sample carried. */
  germanWords: number;
}

/** Everything the readings propose, each answer carrying its evidence. */
export interface StackProposal {
  /** What Node this machine runs, and whether it is enough. */
  node: NodeProposal;
  /** Which commit notation the repository writes in. */
  commitStyle: CommitStyleProposal;
  /** Which ticket scheme its subjects reference. */
  ticket: TicketProposal;
  /** Which language its hub docs are written in. */
  language: LanguageProposal;
}

/**
 * The fewest matching subjects that make a notation a repository's own.
 *
 * TWO, AND IT IS A FLOOR AGAINST COINCIDENCE RATHER THAN A MEASURE OF HABIT. A
 * single `F: fix the thing` is one commit; two is the smallest number that can
 * be a pattern at all. The cost of being wrong is one correction, and the cost
 * of demanding more is a young repository getting no proposal — so the
 * threshold sits where a coincidence stops being plausible and not where a
 * convention is proven.
 */
export const STYLE_SUBJECTS = 2;

/**
 * The fewest occurrences that make a ticket prefix a scheme.
 *
 * TWO, FOR THE SAME REASON AND WITH A SHARPER COST. One stray `ABC-1` in a
 * subject line proposes a tracker to a repository that has none, and the user
 * has to notice and undo it — the confident-but-wrong proposal that makes
 * people distrust the whole probe. Absence still proves nothing in the other
 * direction: no prefix is not evidence against a tracker, which is why the
 * skills ask rather than proposing none.
 */
export const TICKET_OCCURRENCES = 2;

/**
 * The fewest German words that make a sample German.
 *
 * THREE, AND THE HINT IS WEAK ON PURPOSE. It nudges the plan template's wording
 * and nothing else, so a wrong guess costs a word. Three rather than two
 * because the words counted are short and common — `und` and `kann` appear
 * inside English prose quoting a German name — and because the sample is 200
 * lines, where two hits is well inside what a quotation produces.
 */
export const GERMAN_WORDS = 3;

/**
 * The major version a `node --version` string names.
 *
 * @param version the raw output, `v24.20.0` or `''`.
 * @returns the major, or `null` where the string names none.
 */
export const nodeMajor = (version: string): number | null => {
  // ANCHORED AT BOTH ENDS, so `v24.20.0` and `24` both answer and `node 24` —
  // which is not a version string — answers nothing. A leading-digit match
  // would read a garbled reading as a version, and the reassuring direction
  // here is a machine reported as supported that nobody checked.
  const digits = /^v?(\d+)(?:\.\d+)*$/.exec(version.trim());
  return digits === null ? null : Number(digits[1]);
};

/**
 * Whether the Node on this machine meets the floor the repository pins.
 *
 * ONE ANSWER WHERE THERE WERE THREE. `plot-board-probe.sh` held a literal 20,
 * `plot-fleetctl.sh` reads `.nvmrc`, and `plot-boardctl.sh --start` checked
 * nothing at all — so a board could start under a `node` the fleet refuses.
 * The floor is the repository's own pin and never a number written here.
 *
 * @param readings the probe's Node readings.
 * @returns the major found, the floor it was judged against, and the verdict.
 */
export const proposeNode = (
  readings: Pick<StackReadings, 'nodeVersion' | 'nodeFloor'>,
): NodeProposal => {
  const major = nodeMajor(readings.nodeVersion);
  const floor = readings.nodeFloor;
  return {
    major,
    floor,
    supported: major === null || floor === null ? null : major >= floor,
  };
};

/**
 * Which commit notation the counts propose.
 *
 * CONVENTIONAL WINS A TIE WITH THE COLON FORM, because `feat: a thing` matches
 * both patterns by construction — the colon regex accepts a one-or-two letter
 * prefix and `fix`/`feat` are longer, but a repository writing both is
 * overwhelmingly writing conventional commits with the occasional `F:`. The
 * dash form shares no shape with either and is only reached when neither of the
 * other two clears the threshold.
 *
 * @param counts how many subjects matched each notation.
 * @param outOf how many subjects were read.
 * @returns the proposal, or a `null` style where no count clears the threshold.
 */
export const proposeCommitStyle = (
  counts: CommitStyleCounts,
  outOf: number,
): CommitStyleProposal => {
  if (counts.conventional >= STYLE_SUBJECTS && counts.conventional >= counts.colon) {
    return { style: 'conventional', matched: counts.conventional, outOf };
  }
  if (counts.colon >= STYLE_SUBJECTS) {
    return { style: 'arlo-colon', matched: counts.colon, outOf };
  }
  if (counts.dash >= STYLE_SUBJECTS) {
    return { style: 'arlo-dash', matched: counts.dash, outOf };
  }
  return { style: null, matched: 0, outOf };
};

/**
 * Whether a ticket prefix recurs often enough to be a scheme.
 *
 * @param prefix the most frequent prefix read, or `''` where there was none.
 * @param count how many subjects carried it.
 * @param outOf how many subjects were read.
 * @returns the proposal, or a `null` prefix where one occurrence is all there
 *   was.
 */
export const proposeTicket = (
  prefix: string,
  count: number,
  outOf: number,
): TicketProposal =>
  prefix !== '' && count >= TICKET_OCCURRENCES
    ? { prefix, matched: count, outOf }
    : { prefix: null, matched: 0, outOf };

/**
 * Which language the hub docs propose.
 *
 * NO HUB DOC PROPOSES NOTHING, and that is not the same answer as English. A
 * repository with no `CLAUDE.md` and no `AGENTS.md` was never sampled, so a
 * confident `en` there would be a reading nobody took.
 *
 * @param germanWords how many German words the sample carried.
 * @param hasHubDoc whether there was a doc to sample.
 * @returns the proposal, or a `null` language where nothing was read.
 */
export const proposeLanguage = (
  germanWords: number,
  hasHubDoc: boolean,
): LanguageProposal => {
  if (!hasHubDoc) return { language: null, germanWords: 0 };
  return { language: germanWords >= GERMAN_WORDS ? 'de' : 'en', germanWords };
};

/**
 * Everything a probe's readings propose.
 *
 * THE ONE ENTRY POINT THE SKILLS CALL, through `plot-propose-stack.mjs`. The
 * four proposals are separate functions so each threshold can be asserted
 * alone; this composes them so a caller reads one answer per question rather
 * than four calls it could get out of step.
 *
 * @param readings what the two collectors measured.
 * @returns one proposal per question, each carrying the evidence behind it.
 */
export const proposeStack = (readings: StackReadings): StackProposal => ({
  node: proposeNode(readings),
  commitStyle: proposeCommitStyle(readings.commitStyleCounts, readings.subjectsRead),
  ticket: proposeTicket(
    readings.ticketPrefix,
    readings.ticketPrefixCount,
    readings.subjectsRead,
  ),
  language: proposeLanguage(readings.germanWordCount, readings.hasHubDoc),
});
