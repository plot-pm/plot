import { isProposal, isQuestion, type StackProposal } from './stack.js';

/**
 * What adoption writes into a repository, and the four refusals that stop it.
 *
 * ADOPTION IS THE ONE COMMAND THAT WRITES INTO A REPOSITORY PLOT DOES NOT OWN,
 * which makes a wrong write the most expensive one in the estate: a `##  Plot
 * Config` appended over a working one leaves a repository with two answers to
 * every key, and `plot-config.sh` takes the first it finds.
 *
 * The write lived as skill prose until 2026-09-09 — a markdown block in
 * `/plot-init` step 3 an agent copied and filled in. Measured the day before, on
 * three lifecycle fields in one session, that is what a hand write costs: no
 * diff of a script, no test, no PR, and no rule that could have fired.
 *
 * WHAT THIS DECIDES AND WHAT IT DOES NOT. It decides which keys a repository
 * gets, in which order, with which values, and whether the write may happen at
 * all. It renders no file, appends nothing and reads nothing — the performer
 * owns the append, the way `plot-sprint-state.sh` owns the `awk` that knows
 * where a `## Status` line lives.
 *
 * THE PROPOSALS COME FROM `proposeStack` AND ARE NOT RE-DERIVED HERE. A
 * commit notation, a ticket prefix and a content language are already judged by
 * `rules/stack.ts` against thresholds that carry their evidence; this takes the
 * answers and never the counts, so the two rules cannot give one repository two
 * answers to one question.
 */

/** Why adoption refused, as a value a caller branches on rather than a sentence. */
export type AdoptionRefusalReason =
  /** The repository already carries a `## Plot Config` — it is adopted. */
  | 'already-adopted'
  /**
   * Two hub docs exist and nobody said which is the hub.
   *
   * There is no `hub-unnamed` beside it, deliberately. A repository with NO hub
   * doc is not ambiguous — `CLAUDE.md` is created holding just the section, the
   * way `/plot-init` has always done it — so the absent case is a decision and
   * only the two-doc case is a question.
   */
  | 'hub-ambiguous'
  /** An answer a person owes is missing, and no reading can stand in for it. */
  | 'answer-missing';

/** A refused adoption, naming the rule that fired. */
export interface AdoptionRefusal {
  readonly outcome: 'refused';
  /** Which rule fired. */
  readonly reason: AdoptionRefusalReason;
  /** Why it fired here, printed whole by the caller. */
  readonly detail: string;
  /**
   * The questions a person still owes, each named as `/plot-init` names it.
   *
   * Empty for every reason but `answer-missing`. It is the list an unattended
   * run prints as `PLOT-UNASKED` lines, so the refusal carries what would end
   * it rather than leaving the reader to re-derive the set.
   */
  readonly unasked: readonly string[];
}

/** One `## Plot Config` key adoption decided to write. */
export interface ConfigKey {
  /** The key, spelled as `plot-config.sh` reads it. */
  readonly key: string;
  /** The value, without its `- **Key:** ` prefix. */
  readonly value: string;
  /**
   * What was measured, or `''` where the value is a default nobody read.
   *
   * EVERY PROPOSAL CARRIES ITS EVIDENCE — `rules/stack.ts` states the rule and
   * this carries it into the write, so a reviewer reading the adopted repo's
   * hub doc can confirm or reject `Tracker: jira` in one read rather than
   * re-running the probe.
   */
  readonly evidence: string;
}

/** What adoption decided to write, and what it could not answer. */
export interface AdoptionDecision {
  readonly outcome: 'decided';
  /** The hub doc the section lands in, relative to the repository root. */
  readonly hub: string;
  /** Whether that file has to be created — it carries no `## Plot Config`. */
  readonly creates: boolean;
  /** The keys, in the order they are written. */
  readonly keys: readonly ConfigKey[];
  /**
   * The `.gitignore` line the worktree root calls for, or `''` where none does.
   *
   * An absolute root lies outside the repository and needs no ignore rule, so
   * `''` is a decision rather than an omission: writing a line that matches
   * nothing is the reassuring-but-wrong direction this refuses to take.
   */
  readonly ignoreLine: string;
  /**
   * What was proposed but not written, each with the reason.
   *
   * A `CI:` key with two signals found, a `Tracker:` whose base URL nobody
   * supplied: both are gaps the adopted repository must announce, because a
   * half-configured tracker that says so beats `trackerNone` answering
   * `unaskable` for a reason nobody can see.
   */
  readonly gaps: readonly string[];
}

/** What adoption answers: the keys it decided on, or the rule that stopped it. */
export type AdoptionResult = AdoptionDecision | AdoptionRefusal;

/**
 * Narrows a result to a refusal.
 *
 * @param result - what adoption answered.
 * @returns true where a rule stopped the write.
 */
export const isAdoptionRefusal = (result: AdoptionResult): result is AdoptionRefusal =>
  result.outcome === 'refused';

/**
 * The readings a probe took, as `plot-detect-repo.sh` reports them.
 *
 * Only the fields adoption decides by. `plot-propose-stack.mjs` already judges
 * the four the thresholds apply to, and those arrive as {@link AdoptionInput.proposal}
 * rather than being re-read here.
 */
export interface AdoptionReadings {
  /**
   * Whether a `## Plot Config` is already in a hub doc.
   *
   * THE FIRST REFUSAL, and it is the one the plan names. A repository that
   * carries a config has been adopted, and appending a second section gives
   * every key two answers where `plot-config.sh` reads the first.
   */
  readonly hasPlotConfig: boolean;
  /** The hub docs found at the repository root, in the order the probe lists them. */
  readonly hubDocs: readonly string[];
  /** The git host the probe read, or `''` where it read none. */
  readonly gitHost: string;
}

/** What a person confirmed, and what they have not been asked. */
export interface AdoptionAnswers {
  /**
   * The hub doc the section lands in, or `''` where nobody chose.
   *
   * Asked only where two exist. One hub doc is not a question — a user asked to
   * confirm the only `CLAUDE.md` in their repository learns that the tool is
   * not paying attention.
   */
  readonly hub: string;
  /**
   * The gates that make a merge — the Definition of Done.
   *
   * THE ONE ANSWER WORTH ASKING FOR EVERY TIME. The probe finds candidate
   * scripts in `package.json`; which of them gates a merge is a fact no file
   * states, so an empty list is a missing answer and never an empty Definition.
   */
  readonly definitionOfDone: readonly string[];
  /** The tracker confirmed, or `''` where nobody confirmed one. */
  readonly tracker: string;
  /** The tracker's base URL, or `''` where none was supplied. */
  readonly trackerUrl: string;
  /** The CI system confirmed, or `''` where the question was not put. */
  readonly ci: string;
  /** Where dispatched desks go, or `''` to take the proposal. */
  readonly worktreeRoot: string;
}

/** Everything adoption decides by. */
export interface AdoptionInput {
  /** What the probe read. */
  readonly readings: AdoptionReadings;
  /** What the readings propose, from `proposeStack`. */
  readonly proposal: StackProposal;
  /** What a person confirmed. */
  readonly answers: AdoptionAnswers;
  /**
   * Whether no person is present to answer — `PLOT_UNATTENDED=1`.
   *
   * It changes NOTHING about which answers are owed. An unattended run that
   * filled in a default would be the guess the plan's done-when forbids, so a
   * missing answer refuses either way and this decides only what the refusal
   * says: attended, it names the question to put; unattended, it names it as a
   * `PLOT-UNASKED` line, which is the disclosure `/plot-init` already prints.
   */
  readonly unattended: boolean;
}

/**
 * The worktree root adoption proposes where nobody named one.
 *
 * INSIDE THE REPOSITORY, because the absent-key default is not this: with no
 * key, dispatch uses the repository's PARENT with a `plot-wt-` prefix, so the
 * proposal CHANGES where desks go and that is the reason to make it rather than
 * leave the default implicit.
 */
export const DEFAULT_WORKTREE_ROOT = '.worktrees';

/** The keys every adopted repository gets, whatever the probe read. */
const STRUCTURAL_KEYS: readonly ConfigKey[] = [
  { key: 'Branch prefixes', value: 'idea/, feature/, bug/, docs/, infra/', evidence: '' },
  { key: 'Plan directory', value: 'docs/plans/', evidence: '' },
  { key: 'Active index', value: 'docs/plans/active/', evidence: '' },
  { key: 'Delivered index', value: 'docs/plans/delivered/', evidence: '' },
];

/**
 * The `.gitignore` line a worktree root calls for.
 *
 * @param root - the root that was decided.
 * @returns the line, or `''` where the root needs no ignore rule.
 */
export const ignoreLineFor = (root: string): string =>
  root.startsWith('/') ? '' : `${root.replace(/\/+$/, '')}/`;

/**
 * The tracker key adoption writes, and the gap it announces.
 *
 * A MEASURED PREFIX IS A STRUCTURAL SIGNAL and the base URL is nowhere in git
 * history, so a confirmed `jira` with no URL is written WITH its gap named
 * rather than withheld. Absence proves nothing in the other direction: a `null`
 * prefix never proposes `Tracker: none` from silence, so the fallback is `plot`
 * — the repository's plans are its tracker until somebody says otherwise.
 */
const trackerKey = (input: AdoptionInput): { key: ConfigKey; gap: string } => {
  const { tracker, trackerUrl } = input.answers;
  const { prefix, matched, outOf } = input.proposal.ticket;
  if (tracker === '') {
    return {
      key: { key: 'Tracker', value: 'plot', evidence: '' },
      gap: '',
    };
  }
  const evidence = prefix === null ? '' : `${prefix} in ${matched} of ${outOf} subjects`;
  const value = trackerUrl === '' ? tracker : `${tracker} ${trackerUrl}`;
  return {
    key: { key: 'Tracker', value, evidence },
    gap:
      trackerUrl === ''
        ? `Tracker: ${tracker} carries no base URL — issue operations answer unaskable until one is added`
        : '',
  };
};

/**
 * The two readings that identify no system, spelled as the collector spells them.
 *
 * NOT VENDOR NAMES, AND THAT DISTINCTION IS THE WHOLE REASON THE LIST IS SHORT.
 * `ciKey` below branched on `'jenkins'` and `'github-actions'` when it was first
 * written, and the *domain names no vendor* gate refused it — correctly. A rule
 * that knows which systems exist is a rule that needs editing when the third one
 * arrives, which is the property `ports/host.ts` opened its `HostBackend` to keep.
/**
 * The CI key adoption writes, and the gap it announces.
 *
 * ONE SIGNAL PROPOSES, TWO SIGNALS ASK, AND `proposeCi` IS WHERE THAT LIVES.
 * This reads {@link StackProposal.ci} rather than a word: an `ask` never
 * tie-breaks — a team on one vendor's host running another's CI is common, and
 * a silently wrong `CI:` sends every build-status lookup to the wrong system —
 * and a `silent` is a reading rather than a key, because writing `CI: none`
 * records a choice the repository never made.
 *
 * IT READS THE UNION AND NOT `readings.ciSystem`. That field packs four
 * different answers into one string, where `both` and `none` are statements
 * about the reading sitting beside `jenkins`, which is a system — so a caller
 * holding the string cannot tell a config value from a verdict without knowing
 * the two magic words. The union has an arm per answer, and only the `propose`
 * arm has a word to write.
 *
 * THE FOUR CASES ARE THE COLLECTOR'S FOUR, unchanged. A `null` proposal is the
 * probe never reporting `ci_signals` at all, which is *not read* and not the
 * `silent` a tree showing neither signal gives.
 */
const ciKey = (input: AdoptionInput): { key: ConfigKey | null; gap: string } => {
  const confirmed = input.answers.ci;
  if (confirmed !== '') {
    return { key: { key: 'CI', value: confirmed, evidence: 'confirmed' }, gap: '' };
  }
  const read = input.proposal.ci;
  if (read === null) {
    return { key: null, gap: 'no CI key written — the CI system was not read' };
  }
  if (isQuestion(read)) {
    return {
      key: null,
      gap: 'no CI key written — two CI systems left evidence in the tree, and the git host does not decide which runs the PRs',
    };
  }
  if (!isProposal(read)) {
    return { key: null, gap: 'no CI key written — no CI evidence in the tree' };
  }
  return {
    key: { key: 'CI', value: read.proposed, evidence: read.evidence },
    gap: '',
  };
};

/**
 * Which hub doc the section lands in.
 *
 * @param input - the readings and the answers.
 * @returns the file, or a refusal where there is nowhere to write or no choice
 *   was made.
 */
const resolveHub = (input: AdoptionInput): AdoptionRefusal | { hub: string; creates: boolean } => {
  const chosen = input.answers.hub.trim();
  const found = input.readings.hubDocs;
  if (chosen !== '') {
    return { hub: chosen, creates: !found.includes(chosen) };
  }
  // NEITHER EXISTS: `CLAUDE.md` is created holding just this section, which is
  // what `/plot-init` has always done. An empty repository is not an ambiguous
  // one, so this is a decision rather than a question.
  if (found.length === 0) return { hub: 'CLAUDE.md', creates: true };
  if (found.length === 1) return { hub: found[0] as string, creates: false };
  return {
    outcome: 'refused',
    reason: 'hub-ambiguous',
    detail: `${found.join(' and ')} both exist — say which is the hub, because the section lands in one file and every helper reads the first it finds.`,
    unasked: ['Which hub doc is canonical?'],
  };
};

/**
 * Decides the `## Plot Config` a repository gets, or refuses to write one.
 *
 * THE REFUSALS COME BEFORE THE COMPOSITION, in this order: an adopted
 * repository first, because nothing about the proposal matters once the answer
 * is *it already has one*; then where the section would land; then what a
 * person still owes. A composition attempted first would produce a set of keys
 * for a repository that must not receive them, and a caller reading the keys
 * beside the refusal is one refactor away from writing them.
 *
 * @param input - the readings, the proposals and the answers.
 * @returns the keys to write, or a refusal naming the rule that fired:
 *   `already-adopted`, `hub-ambiguous` or `answer-missing`.
 */
export const composeAdoption = (input: AdoptionInput): AdoptionResult => {
  if (input.readings.hasPlotConfig) {
    const where = input.readings.hubDocs.length > 0 ? input.readings.hubDocs.join(' or ') : 'a hub doc';
    return {
      outcome: 'refused',
      reason: 'already-adopted',
      detail: `${where} already carries a '## Plot Config' — this repository is adopted. A second section gives every key two answers and plot-config.sh reads the first, so adoption refuses rather than appending. Edit the section that is there.`,
      unasked: [],
    };
  }

  const hub = resolveHub(input);
  if ('outcome' in hub) return hub;

  if (input.answers.definitionOfDone.length === 0) {
    const question = 'Which gates make the Definition of Done?';
    return {
      outcome: 'refused',
      reason: 'answer-missing',
      detail: input.unattended
        ? `PLOT-UNASKED: ${question} — stopped — the probe finds candidate scripts and cannot see which gates a merge; no files created`
        : `${question} The probe reads candidate scripts from package.json; which of them gates a merge is stated nowhere, so it is asked every time.`,
      unasked: [question],
    };
  }

  const tracker = trackerKey(input);
  const ci = ciKey(input);
  const root = input.answers.worktreeRoot.trim() === ''
    ? DEFAULT_WORKTREE_ROOT
    : input.answers.worktreeRoot.trim();

  const keys: ConfigKey[] = [
    ...STRUCTURAL_KEYS,
    {
      key: 'Definition of Done',
      value: input.answers.definitionOfDone.join(', '),
      evidence: 'confirmed',
    },
  ];
  if (input.readings.gitHost !== '') {
    keys.push({ key: 'Git host', value: input.readings.gitHost, evidence: 'the remote' });
  }
  keys.push(tracker.key);
  if (ci.key !== null) keys.push(ci.key);
  keys.push({ key: 'Worktree root', value: root, evidence: '' });

  const commit = input.proposal.commitStyle;
  if (commit.style !== null) {
    keys.push({
      key: 'Commit style',
      value: commit.style,
      evidence: `${commit.matched} of ${commit.outOf} subjects`,
    });
  }

  return {
    outcome: 'decided',
    hub: hub.hub,
    creates: hub.creates,
    keys,
    ignoreLine: ignoreLineFor(root),
    gaps: [tracker.gap, ci.gap].filter((g) => g !== ''),
  };
};
