/**
 * The four token counters a transcript turn carries.
 *
 * **KEPT APART, NEVER PRE-SUMMED, AND A FIFTH SUMMED FIELD IS FORBIDDEN.**
 * Measured 2026-09-15 over three real transcripts, `cache_read_input_tokens` is
 * 98.6%, 99.3% and 99.36% of a naive four-counter total. The largest:
 *
 * ```
 * input_tokens                     86,922
 * output_tokens                22,016,579
 * cache_creation_input_tokens 117,015,335
 * cache_read_input_tokens  21,479,234,105     ← 99.36% of the sum
 * ```
 *
 * So a four-field total is a cache-read count wearing a cost's name, and cache
 * reads are the cheapest tokens there are — a slice that re-read a large
 * context cheaply would outrank one that generated heavily. A figure a person
 * can act on needs a price-weighted sum, which needs a price table, which this
 * estate excluded by measurement on 2026-08-29. A reader wanting one number is
 * given none.
 *
 * `outputTokens` IS COUNTED HERE AND IS DELIBERATELY ABSENT FROM
 * `CONTEXT_USAGE_FIELDS`, which is not a contradiction. That rule guards a
 * context CEILING, where counting output would charge an agent twice for text
 * arriving as input next turn; this counts SPEND, where output tokens are
 * generated once and billed once. Two readings, two field sets, and widening
 * either to serve the other breaks the one it was written for.
 */
export interface TokenCounts {
  /** `input_tokens` — what the turn carried in, uncached. */
  inputTokens: number;
  /** `output_tokens` — what the turn produced. */
  outputTokens: number;
  /** `cache_creation_input_tokens` — what the turn wrote into the cache. */
  cacheCreationTokens: number;
  /** `cache_read_input_tokens` — what the turn read back from it. */
  cacheReadTokens: number;
}

/**
 * The `usage` field names this rule reads, in the counters' own order.
 *
 * SEPARATE FROM `CONTEXT_USAGE_FIELDS` BY DESIGN — see {@link TokenCounts}. The
 * two lists overlap in three names and must never be merged into one: the
 * ceiling reading would gain `output_tokens` and start reporting agents as
 * spent that are not.
 */
export const SPEND_USAGE_FIELDS: readonly (readonly [keyof TokenCounts, string])[] = [
  ['inputTokens', 'input_tokens'],
  ['outputTokens', 'output_tokens'],
  ['cacheCreationTokens', 'cache_creation_input_tokens'],
  ['cacheReadTokens', 'cache_read_input_tokens'],
];

/** A zero of every counter — the identity a sum starts from. */
const noTokens = (): TokenCounts => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

/**
 * Adds one turn's `usage` into a running total.
 *
 * A field that is absent, not a number, not finite or negative contributes
 * nothing and does not poison the sum — the same rule
 * {@link contextTokensFromUsage} applies, and for the same reason: a `NaN`
 * reaching a record is a guess wearing a number's clothes.
 *
 * @param into - the running total, mutated.
 * @param usage - the turn's parsed `usage` object.
 * @returns true where at least one field was recognised.
 */
const addUsage = (into: TokenCounts, usage: unknown): boolean => {
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return false;
  const record = usage as Record<string, unknown>;
  let found = false;
  for (const [key, field] of SPEND_USAGE_FIELDS) {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    into[key] += value;
    found = true;
  }
  return found;
};

/**
 * What one branch's turns spent, across every session that contributed them.
 *
 * **THE SUBJECT IS THE BRANCH, AND `models` IS A LIST BECAUSE A RUN MAY HOP.**
 * The same count on two models is two different costs, so a reader holding a
 * price table needs to know which — and a run that was corrected onto a
 * different model carries both.
 */
export interface SliceTokens {
  /** The branch these turns were taken on. */
  branch: string;
  /** The four counters, summed over every contributing turn. */
  tokens: TokenCounts;
  /** How many assistant turns carried a recognised `usage`. */
  turns: number;
  /** Every model seen, in first-seen order — never a single "the" model. */
  models: readonly string[];
}

/**
 * One transcript line, as much of it as this rule reads.
 *
 * Takes a PARSED line rather than text: the domain does not touch the disk, so
 * the adapter decides what it read and this decides what it means.
 */
export interface TranscriptLine {
  /** The line's `type` — only `assistant` carries a usage worth summing. */
  type?: unknown;
  /** True on a subagent's turn. */
  isSidechain?: unknown;
  /** The branch checked out when the line was written — top-level, measured. */
  gitBranch?: unknown;
  /** The turn's message, carrying `model` and `usage`. */
  message?: unknown;
}

/** The value `gitBranch` carries while the worktree sits on no branch. */
export const DETACHED_BRANCH = 'HEAD';

/**
 * Which branch a line's turns are charged to, walking one session in order.
 *
 * **A DETACHED (`HEAD`) SEGMENT IS CHARGED TO THE PRECEDING REAL BRANCH, AND
 * THE TEST IS ONE-SIDED AND BACKWARD-LOOKING.** Measured over 1,320 worker
 * transcripts: 74 files carry a `HEAD` segment, 40 return to the same branch,
 * and **0 sit between two different branches**. The between-slice detach is
 * invisible by construction — `reset_desk` detaches and re-attaches in two
 * consecutive `git` calls with no agent turn written between them — so every
 * `HEAD` segment carrying tokens is a MID-SLICE BASELINE, an agent A/B-ing
 * against main, which is this estate's own recommended practice. One measured
 * segment carries 4,792,932 cache reads.
 *
 * **NO LOOKAHEAD, AND THAT IS STRUCTURAL RATHER THAN A SIMPLIFICATION.** The
 * record is written at `seal_declaration`, which runs before `--next` is asked,
 * so at the moment of writing the following branch HAS NOT BEEN CHOSEN. A rule
 * needing it could not be computed at the one site that calls this.
 *
 * **THIS IS NOT A HEURISTIC.** The agent detached FROM a branch and returned TO
 * it, and both facts are in the transcript. A `HEAD` segment with no preceding
 * real branch is charged to NO slice — 34 of the 74 files — which is the honest
 * `none` case rather than a guess.
 *
 * @param gitBranch - the line's `gitBranch` value.
 * @param preceding - the last real branch seen in this session, or null.
 * @returns the branch to charge, or null where the turns belong to no slice.
 */
export const chargedBranch = (gitBranch: unknown, preceding: string | null): string | null => {
  if (typeof gitBranch !== 'string' || gitBranch === '') return preceding;
  if (gitBranch === DETACHED_BRANCH) return preceding;
  return gitBranch;
};

/**
 * Sums one session's lines into per-branch totals.
 *
 * **ORDER IS LOAD-BEARING** — the lines must arrive in file order, because
 * {@link chargedBranch} charges a detached segment to what preceded it and
 * "preceding" is only meaningful in sequence.
 *
 * A subagent's line is skipped. `spend.ts:42-50` measured why: one project
 * directory held 45 session files, 30 of them subagents, and a sum across them
 * belongs to no one. That half of the rule transfers here exactly — the half
 * that does not is the session KEY, for which see {@link sliceTokens}.
 *
 * @param lines - one session's parsed lines, in file order.
 * @param into - totals to accumulate into, keyed by branch.
 */
const foldSession = (
  lines: Iterable<TranscriptLine>,
  into: Map<string, { tokens: TokenCounts; turns: number; models: string[] }>,
): void => {
  let preceding: string | null = null;
  for (const line of lines) {
    // A subagent's turn is a true statement about the wrong process.
    if (line.isSidechain === true) continue;
    const charge = chargedBranch(line.gitBranch, preceding);
    if (
      typeof line.gitBranch === 'string' &&
      line.gitBranch !== '' &&
      line.gitBranch !== DETACHED_BRANCH
    ) {
      preceding = line.gitBranch;
    }
    if (line.type !== 'assistant') continue;
    // A turn on no attributable branch belongs to no slice and is dropped
    // rather than charged to whatever comes next.
    if (charge === null) continue;
    const message = line.message;
    if (typeof message !== 'object' || message === null) continue;
    const msg = message as Record<string, unknown>;
    let bucket = into.get(charge);
    if (bucket === undefined) {
      bucket = { tokens: noTokens(), turns: 0, models: [] };
      into.set(charge, bucket);
    }
    if (!addUsage(bucket.tokens, msg.usage)) continue;
    bucket.turns += 1;
    if (typeof msg.model === 'string' && msg.model !== '' && !bucket.models.includes(msg.model)) {
      bucket.models.push(msg.model);
    }
  }
};

/**
 * Sums every session of a desk into per-branch token totals.
 *
 * **THE SUBJECT IS THE BRANCH WITHIN A DESK, NOT ONE SESSION — and that
 * overturns the plan's own `$PLOT_SESSION_ID` clause, by measurement.**
 * `spend.ts:42-50` forbids summing across a worktree's sessions, and that rule
 * is right for a context CEILING: one turn, one session, one window. It does
 * not transfer to a sum over a RUN, for the same reason `output_tokens` does
 * not transfer.
 *
 * Measured 2026-09-15 over every dispatch desk on this machine:
 *
 * ```
 * branch desks (free-* excluded)      : 41
 *   holding MORE THAN ONE main session: 40      ← one is the exception
 *   largest-session share, median     : 80.8%
 *   largest-session share, worst case : 33.8%
 * ```
 *
 * A worker runs MANY prompts per slice — `run_bounded` is re-entered on every
 * correction and every continuation, and `session_flag()` hands out
 * `--session-id` for a fresh conversation and `--resume` for a continuing one,
 * so each new id is a new file. A sum keyed on one id reads one file and
 * silently omits the rest, shipping a number wrong by a factor of five that
 * looks right.
 *
 * **THE PLAN'S ACTUAL CONCERN IS PRESERVED EXACTLY**: subagent transcripts
 * still belong to no one and are still excluded, by {@link foldSession}. What
 * changes is only the key — branch rather than session.
 *
 * **AND THE FIX IS NOT "TAKE THE NEWEST FILE"**, which is what `spend.ts:48-50`
 * genuinely forbids. One measured desk holds 41 main sessions whose largest is
 * 18.2% of the total, so mtime picks one of 41.
 *
 * @param sessions - each session's parsed lines, in file order within each.
 * @returns one entry per branch that carried a recognised turn, in first-seen
 *   order; empty where nothing was recognised at all.
 */
export const sliceTokens = (
  sessions: Iterable<Iterable<TranscriptLine>>,
): readonly SliceTokens[] => {
  const totals = new Map<string, { tokens: TokenCounts; turns: number; models: string[] }>();
  for (const lines of sessions) foldSession(lines, totals);
  const out: SliceTokens[] = [];
  for (const [branch, bucket] of totals) {
    // A branch whose turns carried no recognised usage is an absence, not a
    // zero — see the module's own rule on what a recorded zero would mean.
    if (bucket.turns === 0) continue;
    out.push({ branch, tokens: bucket.tokens, turns: bucket.turns, models: bucket.models });
  }
  return out;
};

/**
 * One branch's totals out of a desk's sessions, or null where it carried none.
 *
 * **NULL IS THE ANSWER A RECORD MUST NOT TURN INTO A ZERO.** A transcript that
 * could not be read, a desk reaped on another machine, a run that never
 * started — each records NOTHING and says so. A recorded zero is
 * indistinguishable from a free run, and a sum over a zero is wrong in the
 * direction nobody checks.
 *
 * @param sessions - each session's parsed lines, in file order within each.
 * @param branch - the branch that just finished.
 * @returns that branch's totals, or null where it contributed no recognised
 *   turn.
 */
export const tokensForBranch = (
  sessions: Iterable<Iterable<TranscriptLine>>,
  branch: string,
): SliceTokens | null => sliceTokens(sessions).find((entry) => entry.branch === branch) ?? null;
