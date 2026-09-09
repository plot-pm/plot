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
  /**
   * Every CI signal the collector looked for, or `null` where it looked for none.
   *
   * `null` IS NOT AN EMPTY LIST. A collector reporting signals that are all
   * absent looked and found nothing, which proposes no `CI:` key; a collector
   * reporting nothing at all was never asked, and saying *no CI evidence* on
   * its behalf is a reading nobody took. `/plot-init` already draws the same
   * line for the field it reads — *"which is not the same as `none`"*.
   *
   * WHICH SIGNALS EXIST IS THE COLLECTOR'S, so the vendor names arrive as
   * values and this file holds none.
   */
  ciSignals: readonly Signal<string>[] | null;
  /**
   * The Jenkins host a self-describing doc names, or `''` where none does.
   *
   * The SLUG half of the `Jenkins instance` key, whose full form is
   * `<slug>/<job/path>`. The container path is a fact about the Jenkins job
   * tree that no file in the repository states, so it is asked rather than
   * read — the same split adoption already makes for Jira's base URL.
   *
   * A REPOSITORY NAMING NO JENKINS IS THE NORMAL CASE. `''` is not evidence
   * against Jenkins; a `Jenkinsfile` says *Jenkins builds this* without saying
   * *which Jenkins*, so an empty reading asks rather than proposing.
   */
  ciHost: string;
  /**
   * The collector's word for the CI system {@link StackReadings.ciHost}
   * belongs to, or `''` where it read no host.
   *
   * A READING, NOT A CONSTANT. The host field is one CI system's — the probe
   * reads it from that system's own marker — so the collector is the component
   * that knows which word the CI proposal must carry for the host to be worth
   * asking about. Supplying it here keeps that word out of the domain, which
   * CI's vendor gate requires and which the signals already do for every other
   * CI question.
   */
  instanceKeyedCi: string;
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

/**
 * What must be asked before a `Jenkins instance` key can be written.
 *
 * `none` — nothing to ask; the key is not this repository's question.
 * `path` — the slug was measured, so only the container path is missing.
 * `both` — Jenkins builds this and no doc says which, so both halves are asked.
 */
export type CiInstanceAsk = 'none' | 'path' | 'both';

/** What the readings propose about this repository's Jenkins instance. */
export interface CiInstanceProposal {
  /**
   * The instance slug proposed, or `null` where no doc named one.
   *
   * NEVER INVENTED. There is no plausible instance to default to: a slug is
   * site-specific, and a wrong one answers `NOT reachable` — which a reader
   * cannot tell from a Jenkins that is down. So this is what was measured or
   * it is `null`.
   */
  slug: string | null;
  /** Which halves of the key are still missing. */
  ask: CiInstanceAsk;
  /**
   * The key to write from the answers already in hand, or `null` for none.
   *
   * AN UNANSWERED PATH WRITES THE SLUG ALONE. `plot-host.sh:566` treats a
   * bare-host instance as *list at the root scope* and calls that "honest, and
   * the open point's fallback" — so a half-answer degrades to a reading that is
   * wrong but visible, which beats a connector refusing for a reason nobody can
   * see. An unanswered slug writes nothing, because a `Jenkins instance`
   * invented to fill the field is the silent misconfiguration `/plot-init`
   * refuses everywhere else.
   */
  key: string | null;
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
  /**
   * Which CI runs its PRs — a proposal, a question, or silence.
   *
   * THE ONE FIELD OF THE FIVE THAT CAN BE A QUESTION, because it is the one
   * read from two independent signals. The other four each come from a single
   * count, where more evidence sharpens the same answer rather than raising a
   * second one.
   *
   * `null` where the readings carried no `ciSignals` at all — an unasked
   * question, distinct from all three of its answers.
   */
  ci: SignalAnswer<string> | null;
  /** Which Jenkins builds it, where Jenkins does. */
  ciInstance: CiInstanceProposal;
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
 * One structural signal a repository shows, and what it would propose.
 *
 * THE EVIDENCE TRAVELS WITH THE SIGNAL rather than beside it. A caller that
 * has to look up why `jenkins` was proposed will print the word alone, which is
 * the failure `stack.ts`'s header already names for the counts — *"`QUACDS` in
 * 38 of 80 subjects"* rather than *"jira"*.
 */
export interface Signal<T extends string> {
  /** What this signal proposes when it is the only one present. */
  proposes: T;
  /** What was found, in the words a person reads — `a \`Jenkinsfile\``. */
  evidence: string;
  /** Whether the repository shows it. */
  present: boolean;
}

/**
 * One signal was found, and here is what it proposes.
 *
 * @typeParam T the vocabulary the question is answered in.
 */
export interface SignalProposal<T extends string> {
  /** Discriminates this arm. A caller cannot read {@link SignalProposal.proposed} off a question. */
  answer: 'propose';
  /** The word to write. */
  proposed: T;
  /** What was found, ready to print beside it. */
  evidence: string;
}

/**
 * Two or more signals were found, and the rule declines to pick between them.
 *
 * IT CARRIES NO PROPOSED WORD, and that absence is the whole point. The plan
 * settles it: *"A field holding `jenkins` plus `uncertain: true` invites a
 * caller to read the first half."* There is no first half here — the type has
 * no field to read, so a caller that wants a word has to handle the question.
 */
export interface SignalQuestion {
  /** Discriminates this arm. */
  answer: 'ask';
  /** What each conflicting signal was, in the order the caller declared them. */
  found: string[];
}

/**
 * No signal was found, so there is nothing to propose and nothing to ask.
 *
 * NOT THE SAME AS A PROPOSED `none`. A repository showing no CI evidence has
 * not chosen to have no CI — `/plot-init` states it directly: *"`none` is a
 * reading, not a key"* — so this arm says *nothing was read* and the caller
 * writes no key.
 */
export interface SignalSilence {
  /** Discriminates this arm. */
  answer: 'silent';
}

/**
 * What a set of structural signals answers: a proposal, a question, or nothing.
 *
 * THREE ARMS RATHER THAN ONE SHAPE WITH A FLAG. The three are different answers
 * a caller acts on differently — write the key, ask the person, write nothing —
 * and only the first has a word to write.
 *
 * @typeParam T the vocabulary a proposal is made in.
 */
export type SignalAnswer<T extends string> =
  | SignalProposal<T>
  | SignalQuestion
  | SignalSilence;

/** Narrows an answer to the proposal it makes. */
export const isProposal = <T extends string>(
  answer: SignalAnswer<T>,
): answer is SignalProposal<T> => answer.answer === 'propose';

/** Narrows an answer to the question it asks. */
export const isQuestion = <T extends string>(
  answer: SignalAnswer<T>,
): answer is SignalQuestion => answer.answer === 'ask';

/**
 * One signal proposes, two signals ask.
 *
 * THE RULE WAS A PARAGRAPH UNTIL 2026-09-09. `/plot-board-setup` step 2 and
 * `/plot-init` both stated it — *"Where two signals point different ways, setup
 * does not tie-break — it asks, naming what it found"* — and CLAUDE.md's own
 * test says what that made it: *can you answer "did I complete this?" without
 * doing the work?* Yes, so it was a rule, and rules are eventually violated.
 * Here it is a value a test can assert.
 *
 * NO TIE-BREAK EXISTS TO REACH FOR. The rejected design ranked the signals — on
 * the git host, in the CI case — and a team on GitHub running Jenkins is common
 * enough to be this sprint's own user; a silently wrong `CI:` sends every
 * build-status lookup to the wrong system. So the second signal removes the
 * answer rather than losing to the first.
 *
 * ABSENCE IS NOT EVIDENCE AGAINST. Two signals ask even where a caller could
 * guess, and no signal proposes nothing rather than proposing the absent word.
 *
 * @param signals every signal the collector looked for, present or not.
 * @returns the proposal the lone present signal makes, a question naming every
 *   present signal where more than one is, or silence where none is.
 */
export const fromSignals = <T extends string>(
  signals: readonly Signal<T>[],
): SignalAnswer<T> => {
  const present = signals.filter((signal) => signal.present);
  if (present.length === 0) return { answer: 'silent' };
  if (present.length > 1) {
    return { answer: 'ask', found: present.map((signal) => signal.evidence) };
  }
  return {
    answer: 'propose',
    proposed: present[0].proposes,
    evidence: present[0].evidence,
  };
};

/**
 * Which CI the tree proposes, or the question it raises.
 *
 * ONE SIGNAL PROPOSES, TWO SIGNALS ASK, and this is that rule applied to CI. It
 * is `fromSignals` under a name the callers read, and it holds no list of
 * systems: **the signals arrive from the collector, which is the only component
 * that knows a `Jenkinsfile` when it sees one.** A third CI system needs a
 * signal added where the tree is read and no edit here — the property
 * `adoption.ts` already states for the key it writes, held one layer earlier.
 *
 * WHAT IT DOES NOT DO IS DECIDE WHICH CI A REPOSITORY SHOULD USE. It reads what
 * the collector found. Whether the described pipeline is the one that gates a
 * merge is a person's answer, and this asks for it whenever the tree gives two.
 *
 * @param signals every CI signal the collector looked for, present or not.
 * @returns the proposal, the question, or silence.
 */
export const proposeCi = (signals: readonly Signal<string>[]): SignalAnswer<string> =>
  fromSignals(signals);

/**
/**
 * What a repository's Jenkins instance is, and what is left to ask.
 *
 * IT RUNS ONLY WHERE JENKINS BUILDS THE REPOSITORY. `CI: jenkins` is the
 * trigger, because `plot-host.sh:677` refuses for want of this key only when
 * the CI is Jenkins — a GitHub Actions repository is not missing anything.
 * Where two signals were found the CI question is still open, so this asks
 * nothing until it is answered.
 *
 * ONE QUESTION WHERE THE SLUG WAS FOUND, TWO WHERE IT WAS NOT. A reader who
 * must supply a whole `<slug>/<job/path>` value is being asked to know the
 * key's format, which the goal — *sees real build status without being told
 * which keys to set* — rules out.
 *
 * @param ciHost the host a self-describing doc named, or `''`.
 * @param isJenkins whether the CI proposal is `jenkins`.
 * @returns the slug proposed, what is still asked, and the key writable now.
 */
export const proposeCiInstance = (
  ciHost: string,
  isJenkins: boolean,
): CiInstanceProposal => {
  if (!isJenkins) return { slug: null, ask: 'none', key: null };
  const slug = ciHost.trim();
  return slug === ''
    ? { slug: null, ask: 'both', key: null }
    : { slug, ask: 'path', key: slug };
};

/**
 * Whether the CI answer names the system whose instance the readings describe.
 *
 * THE DOMAIN NAMES NO VENDOR, so the word is not written here. The comparison
 * is against {@link StackReadings.instanceKeyedCi} — the collector's own name
 * for the system it read a host for, supplied as a value with the reading it
 * belongs to. CI's vendor gate is the rule; this is what obeying it looks like
 * in the one place the rule needs a word at all.
 *
 * WHY A WORD IS NEEDED HERE AND NOWHERE ELSE: an instance key is one CI
 * system's question. `plot-host.sh:677` refuses for want of it only for that
 * system, and a repository built by any other is missing nothing. Every other
 * rule in this file treats the proposed word as opaque and would be wrong to
 * read it.
 *
 * A QUESTION IS NOT A PROPOSAL, and that is the guard the arms give for free.
 * Where two signals were found the answer is `ask`, carrying no word at all —
 * `SignalQuestion` has no field to read — so this is false and no instance is
 * asked for until a person has said which CI runs the repository.
 *
 * @param signals every CI signal the collector looked for, or `null`.
 * @param instanceKeyedCi the collector's word for the instance-keyed system,
 *   or `''` where it read no host and therefore names none.
 * @returns true only where one signal was present and proposed that word.
 */
const proposesInstanceKey = (
  signals: readonly Signal<string>[] | null,
  instanceKeyedCi: string,
): boolean => {
  if (signals === null || instanceKeyedCi === '') return false;
  const answer = proposeCi(signals);
  return isProposal(answer) && answer.proposed === instanceKeyedCi;
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
  ci: readings.ciSignals === null ? null : proposeCi(readings.ciSignals),
  // THE TRIGGER ARRIVED. `proposeCiInstance` was wired to a literal `false`
  // until 2026-09-09, with main's own comment naming the reason -- *"the CI
  // proposal does not exist yet ... the arrival of `ci.reading` is a one-line
  // change here and nothing else."* This is that line.
  //
  // A QUESTION IS NOT A `jenkins` READING. Where two signals were found the CI
  // answer is `ask`, `isProposal` is false, and no instance is asked for --
  // which is what `proposeCiInstance`'s own header already required: *"Where
  // two signals were found the CI question is still open, so this asks nothing
  // until it is answered."*
  ciInstance: proposeCiInstance(
    readings.ciHost,
    proposesInstanceKey(readings.ciSignals, readings.instanceKeyedCi),
  ),
});
