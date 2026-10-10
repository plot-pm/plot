import {
  SLOT_POLL_MS,
  answerKind,
  boundFromLimit,
  concurrencyBound,
  foldPrIndex,
  heldSlots,
  loweredConcurrency,
  pendingOpenPrNumbers,
  prWindowFor,
  reactionTo,
  refreshIntervalMs,
  refusalKind,
  slotVerdict,
  waitExhausted,
  type LimitBasis,
  type LimitReading,
  type PrAnswerKind,
  type PrIndex,
  type PrIndexRow,
  type Reaction,
} from '@plot-pm/domain';
import { prIndexFile, slotsFile } from '@plot-pm/domain/adapters';
import type { Host } from '@plot-pm/domain/ports/host';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import type { Scripts } from '@plot-pm/domain/ports/scripts';

import { PR_REFRESH_MS } from './fleet-scan.js';

/**
 * What the PR reader keeps from one pass to the next.
 *
 * The cadence, the backoff, the host's limit reading and the maps the last pass
 * produced. The board's cache entry satisfies this structurally, so the board
 * and the fleet daemon run one reader over two holders.
 */
export interface PrState {
  /** Open PRs by head branch. Null until a pass or the store supplies them. */
  prs: Map<string, PrRecord> | null;
  /** Every PR by number, whatever its state. */
  prsByNumber: Map<number, PrRecord> | null;
  /** One ranked PR per head branch, every state. */
  prsByHead: Map<string, PrRecord> | null;
  /** Epoch ms the last answering pass finished, or null. */
  prAt: number | null;
  /** The last pass's failure or partial-answer sentence, or null. */
  prError: string | null;
  /** Requests per hour the spend record reports for this machine, or null. */
  prSpendPerHour: number | null;
  /** Epoch ms the host's limit resets, or null. */
  prResetAt: number | null;
  /** The lowered concurrency bound after a secondary refusal, or null. */
  prConcurrency: number | null;
  /** Live slot claims held on the account, or null where unread. */
  prSlotsHeld: number | null;
  /** The connector's request ceiling, or null. */
  prLimit: number | null;
  /** Epoch ms a full read failed, or null. */
  prFullReadFailedAt: number | null;
  /** Consecutive no-progress re-asks per pending PR number. */
  prPendingReaskStreak: Map<number, number>;
  /** Epoch ms of each PR's last re-ask by number. */
  prReaskAt: Map<number, number>;
  /** Whether the ceiling was observed or predicted. */
  prLimitBasis: LimitBasis;
  /** The account the cap is keyed by, or null. */
  prAccount: string | null;
  /** Epoch ms the next pass is due. */
  prNextAt: number;
  /** Whether `prNextAt` is a backoff the host named. */
  prNextIsBackoff: boolean;
  /** The ordinary interval last stamped, in ms. */
  prIntervalMs: number;
  /** The resolved git host backend, or null before the first ask. */
  backend: string | null;
}

/**
 * A PR state as a fresh process holds it.
 *
 * @returns every field at its cold-start value; `prNextAt` is 0 so the first pass runs at once.
 */
export const freshPrState = (): PrState => ({
  prs: null,
  prsByNumber: null,
  prsByHead: null,
  prAt: null,
  prError: null,
  prSpendPerHour: null,
  prResetAt: null,
  prConcurrency: null,
  prSlotsHeld: null,
  prLimit: null,
  prFullReadFailedAt: null,
  prPendingReaskStreak: new Map(),
  prReaskAt: new Map(),
  prLimitBasis: 'unknown',
  prAccount: null,
  prNextAt: 0,
  prNextIsBackoff: false,
  prIntervalMs: PR_REFRESH_MS,
  backend: null,
});

/** What one PR pass reaches. */
export interface PrWorld {
  /** Asks the host and reads the spend record. */
  scripts: Scripts;
  /** Names the git host backend. */
  host: Host;
  /** The repository's PR index. The pass folds the host's answer into it. */
  store: PrIndexStore;
  /** Runs after a pass the host answered, with the open PRs that pass listed. */
  afterAnswer?: (open: Map<string, PrRecord>) => Promise<void>;
  /** The `Checks wait` bound in ms; defaults to `PR_CHECKS_WAIT_MS`. */
  checksWaitMs?: number;
  /** The clock in epoch ms; defaults to `Date.now`. A test injects one. */
  now?: () => number;
}

/**
 * The longest the PR fetch backs off to when the host reports a rate limit and
 * gives no reset time to wait for. Doubling from 60 s stops here rather than
 * growing without bound — past two minutes the tab is stale enough that the
 * board should be retrying, not sulking.
 */
export const PR_BACKOFF_MAX_MS = 120_000;

/**
 * What ONE refresh costs, in host requests, on each backend.
 *
 * The number the cadence above was missing. `PR_REFRESH_MS` reasons about a
 * refresh as a unit — "60 s between refreshes" — and that reasoning is only
 * about spending if a refresh is one request. On GitHub the PR list is one
 * call. On Bitbucket it is three: `plot-host.sh` expands `--state all` into
 * `open`, `merged` and `declined` because `bb` has no `all` state, so the one
 * call this file makes fans out into three round trips before it returns.
 *
 * `issue-list` used to cost ZERO on Bitbucket — the adapter exited 4 before
 * touching the network — and this table counted only `pr-list` on that basis.
 * `bb` gained issue support and `plot-host.sh` now ANSWERS for Bitbucket by
 * calling `bb issue list`, so the same refresh that runs `pr-list` now also
 * reaches the tracker: ONE more request (a single `bb issue list` call — bb has
 * no `all` for issues either, but `--state new --state open` is one invocation
 * and one round trip). `runs` still costs zero (bb has no run listing).
 *
 * This is the NAIVE per-refresh cost — what one refresh would spend if the
 * cadence did not stretch. `prRefreshMsFor` multiplies `PR_REFRESH_MS` by it,
 * so the hourly spend stays 60 on both hosts; the higher a host's per-refresh
 * cost, the further apart its refreshes. Measured against
 * `bitbucket.org/quatico/ekzweb` (issue #226):
 *
 *     GitHub      1 request  → refresh every  60 s → 60 requests / hour
 *     Bitbucket   4 requests → refresh every 240 s → 60 requests / hour
 *                 (3 for pr-list --state all, 1 for issue-list)
 *
 * Before the cadence stretched, an un-throttled 60 s tick spent 4 × 60 = 240
 * Bitbucket requests an hour. A board left open a working day made ~1400
 * Bitbucket requests just watching, and reached `HTTP 429 — Rate limit for this
 * resource has been exceeded` account-wide, with every `bb` call from the
 * operator's own shell failing too. That is why the issue call is counted the
 * moment it becomes real rather than in a follow-up: an under-counted cost
 * under-stretches the cadence, and an under-stretched cadence against an
 * already-hit limit is the failure this measurement exists to prevent.
 *
 * A backend absent from this table costs 1 — the naive assumption, kept as the
 * default so a host added later behaves exactly as every host did before, and
 * is slowed only once someone measures what it really costs.
 *
 * THE PENDING-CHECK RE-ASK (#1277) IS DELIBERATELY NOT COUNTED HERE. Every
 * other row in this table prices a request this file makes on EVERY refresh;
 * the re-ask fires only on a delta, and only when the store holds an OPEN PR
 * whose `checks` is still `pending` — on a quiet estate with no PR mid-CI, the
 * cost stays what it always was. Baking it into this static table would
 * stretch every GitHub refresh to pay for a question most refreshes never
 * ask, the over-declaring failure the paragraph above already names. What
 * bounds its real cost instead is `PR_PENDING_REASK_LIMIT`: a PR cannot be
 * re-asked more than a fixed number of consecutive times, so the worst case
 * is small and finite rather than one more request forever.
 */
export const PR_REQUESTS_PER_REFRESH: Record<string, number> = {
  // One `gh pr list --state all` call, whatever the states asked for; the
  // GitHub `issue-list` and `runs` calls ride the same GraphQL budget and the
  // board's own measurement treats the refresh as one unit there.
  github: 1,
  // Three for `pr-list --state all` (open, merged, declined — `bb` has no `all`
  // state) plus one for `issue-list`, which now reaches the network instead of
  // exiting 4. Do not "fix" the three by inventing an `all` — it would fabricate
  // an answer the host cannot give.
  //
  // FOUR IS THE COST OF THE CALL THIS FILE MAKES, and since #333 that is a
  // statement about a call SHAPE rather than about the backend. `pr-list` now
  // takes a repeatable `--branch`: given branches, the Bitbucket arm asks its
  // REST endpoint about each one by name — branches × states queries, exact and
  // complete — and given none it lists as before. `refreshPrs` below passes
  // none, so it still makes three listings plus the issue call, and four is
  // what it spends.
  //
  // WHOEVER MOVES THIS FILE ONTO THE SWEEP MUST CHANGE THIS NUMBER, and the
  // arithmetic is `branches × 3 + 1` rather than a constant. On the repository
  // measured 2026-09-20 that is 11 × 3 + 1 = 34 against today's 4, which takes
  // the interval from 240 s to roughly half an hour — so such a change is a
  // cadence decision, not a call-site edit. `plot-fleet-scan.sh` pays that cost
  // deliberately: it runs on an operator's command, not on a 5 s timer, and it
  // is the caller whose join the truncation actually breaks.
  //
  // UNDER-DECLARING IS THE FAILURE NAMED ABOVE, and over-declaring is its
  // mirror: stretching this board's cadence for queries it never issues would
  // slow every refresh to pay for nothing.
  //
  // A DELTA CHANGED WHAT EACH REQUEST COSTS AND NOT HOW MANY ARE MADE, so this
  // number is unchanged by the `--since` slice. The Bitbucket arm still calls
  // once per state plus once for issues, whether or not a window narrows each
  // call: a windowed listing goes through `bb_window_listing`, which asks REST
  // with `updated_on>=` and walks its pages, so it narrows but still spends one
  // call per state. GitHub likewise makes one call with `--search` exactly as
  // it made one without.
  //
  // WHAT A CHEAPER CALL BUYS IS LATENCY, NOT BUDGET, and conflating the two is
  // how a table like this goes wrong. 29 811 ms became 943 ms because the host
  // stopped assembling 933 rows; it is still one request against the same quota
  // and must still be spaced as one. Lowering this to "pay for" a faster call
  // would tighten the cadence against a limit that never moved — the ~1400
  // requests and account-wide `HTTP 429` this table's own header records.
  bitbucket: 4,
};

/**
 * How many consecutive re-asks a stuck-`pending` open PR survives before the
 * delta stops asking about it by number.
 *
 * A check queue that never runs would otherwise be re-asked every delta
 * forever — one more request per refresh with no answer ever arriving. 5
 * consecutive no-progress answers, at the GitHub cadence this table prices
 * above (one delta roughly every 60 s), is on the order of five minutes of
 * asking before the bound gives up; the PR falls back to being caught by the
 * next full read, the same ceiling every OPEN PR already had before this
 * slice.
 */
export const PR_PENDING_REASK_LIMIT = 5;

/** The `Checks wait` default, in ms — `plot-config.sh get "Checks wait"` is 3600 s. */
export const PR_CHECKS_WAIT_MS = 3_600_000;

/** The shortest gap between re-asks once `PR_PENDING_REASK_LIMIT` is spent, in ms. */
export const PR_PENDING_REASK_SLOW_MS = 300_000;

/**
 * How many PRs to ask the host for. The CLI's own default is 30, which is
 * plenty for the open PRs the fleet reads and far too few once the board asks
 * for merged ones too — the newest 30 would crowd out exactly the finished work
 * whose links a delivered card wants.
 *
 * 300 is chosen to cover a repo's history rather than to be a real bound: past
 * it, old cards lose their links and nothing else breaks, because an unknown
 * URL already renders as no link. A number large enough to be wrong slowly is
 * better here than a page-walking loop on a 5 s timer.
 */
/**
 * How many PRs the board asks the host for, across every state.
 *
 * **1000, and 300 was three PRs from silently truncating.** Measured 2026-08-21:
 * this repo holds **297** PRs, `--state all` returns the newest first, and the
 * oldest — #49-#55, from July — sat at the very end of a 300-wide window. Opening
 * four more PRs would have pushed them out, and the symptom is not an error: a
 * branch simply loses its PR link and its status, reading as though no PR had ever
 * existed. It was watched happening between two board restarts.
 *
 * `plot-host.sh` warns about exactly this in its own header — *"--limit raises the
 * host CLI's default page of 30, which `--state all` exhausts immediately"* — and
 * the caution was applied to the CLI's default without being carried through to
 * the board's own ceiling.
 *
 * 1000 buys years at this repo's rate rather than months. The cost is one host
 * query per PR-refresh cycle, already the whole bill this refresh pays for, and a
 * larger page does not add a round trip.
 *
 * A REAL CEILING, not `Infinity`: an unbounded query against a repo with tens of
 * thousands of PRs would be a different defect, and the number is what makes the
 * next reader ask whether it is still enough.
 */
export const PR_LIMIT = 1000;

/**
 * How long a delta may run before the board re-reads everything.
 *
 * **A FULL READ IS REQUIRED, NOT OPTIONAL, AND THIS IS THE WHOLE REASON.** A
 * delta cannot see a DELETION: `updated:>` returns rows that changed, and a PR
 * the host no longer has changes nothing — it simply stops being listed, which
 * a narrowed call cannot distinguish from a PR that did not change. Only a
 * whole answer replaces the store, and only a replacement drops it. The same
 * applies to a PR force-pushed without a metadata change, and to a host that
 * back-dates `updated_on`: both sit stale until something asks again.
 *
 * **TWENTY-FOUR HOURS IS A GUESS, AND IT IS RECORDED AS ONE.** The design says
 * so in `DESIGN-index.md` §"What is still open" item 3: *"Daily is a guess; the
 * honest input is how often a delta misses something, which only running it
 * will say."* No measurement of the miss rate exists yet, so nothing here could
 * derive it, and inventing an argument for a number nobody measured would be
 * worse than naming the guess.
 *
 * **WHAT MAKES THE GUESS SAFE RATHER THAN MERELY CHEAP** is the cost either way
 * round. Too long, and a deleted PR lingers as a row whose link 404s — visible,
 * local, and corrected on the next full read. Too short, and the board pays
 * 29 811 ms more often than it needs to, which is the cost this whole plan
 * exists to remove. The first is a wrong row; the second is a slow board. A day
 * sits where a wrong row is corrected before most operators would act on it,
 * and the 30 s is paid once against roughly 1440 refreshes.
 */
export const PR_FULL_READ_MS = 24 * 60 * 60 * 1000;

/**
 * How long a failed full read stands the next one down.
 *
 * **A SERVER-SIDE TIMEOUT IS NO RATE LIMIT**, so `hostReaction` names no wait,
 * the next refresh follows in `PR_REFRESH_MS` (60 s), and the full read is
 * still due — the heaviest query on the estate, every minute. An hour is long
 * enough that a GitHub GraphQL 504 (measured 46-68 s on this repository, #1087)
 * is not retried into the ground, and short enough that the daily full read is
 * delayed rather than abandoned.
 *
 * **NOT A RETRY.** The refreshes inside the hour ask a delta, which is the
 * cheap call. Retrying the full read at once would double the cost of a request
 * that already ran too long.
 */
export const PR_FULL_READ_GRACE_MS = 60 * 60 * 1000;

/** One PR as the host adapter reports it, collapsed to what the tab needs. */
export interface PrRecord {
  number: number;
  head: string;
  /** OPEN · MERGED · CLOSED, as the adapter normalizes it. */
  state: string;
  draft: boolean;
  /** green · pending · failing · none · unknown — see plot-host.sh pr-list --rich. */
  checks: string;
  /**
   * mergeable · conflicting · unknown — see plot-host.sh pr-list --rich.
   *
   * A SEPARATE question from `checks`, and the one that disambiguates it.
   * GitHub starts no workflow for a PR that does not merge cleanly, so a
   * conflicting PR reports an empty rollup — `checks: 'none'`, indistinguishable
   * from a bot PR whose run is waiting for a human to approve it.
   *
   * `unknown` on every host that cannot answer (Bitbucket) and on every payload
   * written before the field existed. Consumers must not read it as clean:
   * absent is not false, the same rule the local signals obey.
   */
  mergeable?: string;
  /** APPROVED · CHANGES_REQUESTED · REVIEW_REQUIRED · "" — informational only. */
  review: string;
  /**
   * WHICH checks failed, by name — the detail `checks` collapses into the single
   * word `failing`.
   *
   * `failing` names a symptom and withholds which machine produced it. On
   * 2026-08-17 a markdown-only branch failed `validate` because the Playwright
   * CDN answered `403 — this service is not available in your location`, and
   * reaching that sentence took ten minutes of opening logs — from a row that
   * already held the check name and did not say it.
   *
   * NAMES ONLY, and nothing interprets them. A heuristic mapping a failing check
   * to the paths a branch changed was explicitly rejected: that table is
   * unmaintained by construction and goes silently wrong the first time a
   * workflow is restructured.
   *
   * Absent on an older adapter and on Bitbucket, normalized to [] — which reads
   * as *no names available*, never as *nothing failed*: `checks` is what says
   * whether anything failed, and these two fields answer different questions.
   */
  failing_checks?: string[];
  /**
   * The PR's web URL, verbatim from the host adapter — the board constructs no
   * URL of its own, so it can never turn a self-hosted Bitbucket into a
   * github.com link. "" where the host CLI omits it (an older `gh`/`bb`), which
   * consumers must render as *no link* rather than as a guess.
   */
  url: string;
  /**
   * When the host last saw this PR change, in the host's own words.
   *
   * `updatedAt` on GitHub, `updated_on` on Bitbucket, normalized to the one
   * name by `plot-host.sh pr-list --rich`. Absent on an older adapter, and
   * absent is not a date: a row carrying none contributes nothing to the
   * store's watermark rather than contributing a zero, which would reopen a
   * window back to 1970 on every refresh.
   *
   * **THE HOST'S CLOCK, NEVER THIS BOARD'S.** A client two seconds ahead of the
   * host excludes every PR updated in that gap from every later `updated:>`
   * window — permanently and silently, because the window never reopens.
   */
  updatedAt?: string;
  /**
   * The author's handle as the host spells it — GitHub's login, Bitbucket's
   * `nickname` — or `''` where the host did not answer.
   *
   * `''` means the owner is unknown, and `ownership` in the domain shows such a
   * row. It is never written to the store as `''`: `storeRow` omits it.
   */
  author?: string;
  /** The head commit the host answered, or absent; never `''` in the store. */
  headSha?: string;
  /** When the fold first saw `headSha`, this machine's clock; set by `storeRow`. */
  headSince?: string;
  /** The commit `checks` was computed for; the rollup arm only. */
  checksSha?: string;
  /** The host's merge time; absent on an open PR. */
  mergedAt?: string;
}

/**
 * Fetch PRs through the adapter — never `gh` directly. Principle 3 keeps host
 * knowledge in one place, and a board that shelled out to `gh` itself would
 * silently become GitHub-only.
 *
 * `--state all` because the two indexes want different sets. The fleet asks
 * about work in flight and only ever consults OPEN PRs; the board wants a link
 * for every PR a plan names, and a delivered plan's PRs are all merged — an
 * open-only fetch would leave exactly the finished work unlinked. One call
 * serves both, and `byHead` is filtered back down to open below so fleet
 * classification sees precisely what it saw before.
 *
 * `--limit` is required alongside it: the host CLI pages at 30, so `--state
 * all` would otherwise return the newest 30 PRs and nothing older.
 */
/**
 * How long to wait after a failed PR fetch, in ms — or null when the failure is
 * not a rate limit and the ordinary cadence should simply continue.
 *
 * Read from the host CLI's own message rather than from a header, because that
 * is all a shelled-out `gh`/`bb` hands back. The strings this recognizes are
 * GitHub's, quoted from a real exhaustion on 2026-08-16:
 *
 *     GraphQL: API rate limit already exceeded for user ID 870334
 *     You have exceeded a secondary rate limit. Please wait 60 seconds…
 *
 * Anything unrecognized returns null ON PURPOSE. Guessing a long wait from an
 * unfamiliar message would turn a transient network blip into two minutes of
 * silence, and the board would look stalled for a reason nothing could explain.
 * A message that names its own wait is honoured; everything else keeps the
 * normal timer, and the error is surfaced either way.
 *
 * `fetchGraphqlResetMs` is the escape from the bare message's guess. When the
 * message carries neither a named wait nor a reset stamp, the host still knows
 * when the budget returns — `gh api rate_limit` states it and is itself free
 * (the rate-limit endpoint is not rate-limited). The fetcher supplies "ms from
 * now until reset" or null when even that cannot be read, and the constant is
 * the last resort behind it. It is consulted ONLY on the bare branch and ONLY
 * once: the named-wait and reset-stamp branches already hold the answer, and a
 * non-rate-limit failure must not spend a call on its way to null. With no
 * fetcher supplied the ceiling answers exactly as before — the pure path the
 * other host callers keep until they choose to pass one.
 */
export const rateLimitBackoffMs = (
  message: string,
  now?: number,
  fetchGraphqlResetMs?: () => Promise<number | null>,
): number | null | Promise<number | null> => {
  const at = now ?? Date.now();
  // "Please wait 60 seconds" / "try again in 45 seconds" — the host said how
  // long, so wait exactly that (never below the ordinary cadence, since a
  // shorter wait would just re-hit the limit).
  const seconds = /(?:wait|retry|try again)(?:\s+\w+){0,3}?\s+(\d+)\s*seconds?/i.exec(message);
  if (seconds) return Math.max(PR_REFRESH_MS, Number(seconds[1]) * 1000);

  // An absolute reset stamp, if the message carries one.
  const reset = /rate limit.*?reset[^0-9]{0,20}(\d{10,13})/i.exec(message);
  if (reset) {
    const stamp = Number(reset[1]);
    const ms = (stamp < 1e12 ? stamp * 1000 : stamp) - at;
    if (ms > 0) return ms;
  }

  // The bare exhaustion message — no reset offered. Ask the host once for the
  // real reset; only if that cannot be read do we fall back to the ceiling
  // rather than keep firing into a closed door.
  if (/rate limit/i.test(message)) {
    if (fetchGraphqlResetMs) {
      return fetchGraphqlResetMs().then((ms) =>
        ms != null && ms > 0 ? ms : PR_BACKOFF_MAX_MS);
    }
    return PR_BACKOFF_MAX_MS;
  }
  return null;
};

/**
 * How long to wait after a refusal, and what to lower — the REACTION, which
 * until this slice nothing performed.
 *
 * **THE MESSAGE PARSING ABOVE STAYS; THE DECISION MOVES TO THE DOMAIN.**
 * `rateLimitBackoffMs` reads a duration the connector spelled out in its own
 * words — *"Please wait 90 seconds"*, *"reset at 1700000180"* — and that is a
 * connector fact only a string can carry. What to DO with it is a rule, and
 * `reactionTo` owns it: which limit was hit, whether the reset describes that
 * limit, whether the wait is a floor the host named or a ceiling this inferred.
 *
 * **THE RESET COMES FROM THE RECORD, NOT FROM `gh api rate_limit`.** The record
 * holds `X-RateLimit-Reset` harvested from a real response, and the endpoint was
 * measured 2026-09-01 reporting `graphql: 5000/5000, used 0` at the same moment
 * a live call's headers read `remaining 0`. So the fallback that asked the
 * endpoint is now the fallback that reads the file every spender already writes:
 * free where the endpoint is metered, and right where it was wrong.
 *
 * **AND THE CADENCE IS NOT AN INPUT HERE.** `reaction.waitMs` is a one-off delay
 * before the next attempt; `prIntervalMs` is untouched by every branch of this.
 * A refusal that also lowered the interval would compound with the division
 * `cadenceStretch` is already performing and drift downward with nothing to
 * restore it.
 *
 * @param message - what the host CLI said, verbatim.
 * @param resetAt - when the record says this account's bucket refills, epoch
 *   milliseconds; null where no live reading carries one.
 * @param now - epoch milliseconds.
 * @returns the reaction, or null where the failure was not a limit at all and
 *   the ordinary cadence should simply continue.
 */
export const hostReaction = (
  message: string,
  resetAt: number | null,
  now = Date.now(),
): Reaction | null => {
  const kind = refusalKind(message);
  if (kind === null) return null;
  // The connector's own words first: a named wait and an absolute stamp are
  // both durations the host stated, and `rateLimitBackoffMs` is where this repo
  // already reads them. Its bare-message ceiling is NOT wanted here — that is
  // the guess `reactionTo` replaces with the record's reset — so the ceiling is
  // recognised by value and dropped.
  const said = rateLimitBackoffMs(message, now);
  const named = typeof said === 'number' && said !== PR_BACKOFF_MAX_MS ? said : null;
  const reaction = reactionTo(kind, resetAt, now, named);
  if (reaction === null) return null;
  // A QUOTA THE HOST NAMED A WAIT FOR HONOURS THAT WAIT. `reactionTo` reads the
  // record's reset for a quota and ignores `retryAfterMs`, which is right when
  // the record has one; where it has none, the host's own stamp beats this
  // rule's five-minute ceiling, because it is a number the connector stated.
  if (kind === 'quota' && !reaction.stated && named !== null) {
    return { ...reaction, waitMs: named, stated: true };
  }
  return reaction;
};

/**
 * The wait one reaction asks for, in the shape the cadence gate takes.
 *
 * NULL IS "REJOIN THE ORDINARY CADENCE", which is what an outage and a
 * refilled bucket both mean: `prNextDueAt` reads null as *no floor was named*
 * and anchors to the fetch's start as a success does. A zero wait must not
 * arrive as a floor of `now`, because a floor is compared with no slack and
 * would refuse the very tick this period is entitled to.
 *
 * @param reaction - what `hostReaction` answered, or null.
 * @returns the milliseconds to wait, or null where nothing is owed.
 */
export const waitOf = (reaction: Reaction | null): number | null => {
  if (reaction === null || reaction.waitMs <= 0) return null;
  return reaction.waitMs;
};

/**
 * Applies the half of a reaction that is not a wait — the concurrency bound.
 *
 * **THE FREQUENCY IS UNTOUCHED HERE AND THAT IS THE WHOLE POINT.** A secondary
 * limit bounds requests AT ONCE, so lowering the interval would correct a
 * number the refusal says nothing about, and it would compound with the
 * division `cadenceStretch` is already performing — a drift downward with
 * nothing to restore it. So this writes `prConcurrency` and never
 * `prIntervalMs`.
 *
 * **IT ONLY EVER FALLS.** `loweredConcurrency` refuses to raise, because a
 * refusal is evidence in one direction: it proves the count was too high, and a
 * quiet minute proves nothing about how much higher it could have gone. The cap
 * itself is `bug/the-budget-bounds-simultaneous-calls`; this slice lowers what
 * that slice will later bound.
 *
 * @param entry - the cache entry to record the bound on.
 * @param reaction - what `hostReaction` answered, or null.
 */
export const applyReaction = (entry: PrState, reaction: Reaction | null): void => {
  // A REFUSAL WITH NO BOUND TO LOWER STILL ESTABLISHES ONE. `prConcurrency` is
  // null until something refuses, so there is nothing to halve on the first
  // secondary limit — and answering *still unbounded* would discard the only
  // measurement this estate has ever taken of the real ceiling. The connector's
  // own proposal is what the refusal disproves, so that is what it halves; a
  // connector proposing nothing falls back to the bound the board was running
  // at, which is what the refusal was measured against.
  // ONLY A REACTION THAT LOWERS WRITES ANYTHING. A quota leaves the bound where
  // it was, and storing the derived proposal on the way past would FREEZE it: a
  // value that is recomputed from the connector's reading every refresh would
  // become one that outlives the reading it came from, so a vendor changing its
  // limit would stop moving the cap. Measured by `pr-concurrency.test.ts`,
  // which asked for a quota and got the proposal written into the correction.
  if (reaction === null || reaction.concurrencyFactor >= 1) return;
  const current = entry.prConcurrency ?? boundFromLimit(limitReadingOf(entry));
  // NOTHING TO CORRECT AND NOTHING INVENTED. A connector that reports no
  // ceiling gives a refusal no number to halve, and a bound picked here would
  // be the compiled-in seven under another name. The next reading proposes one;
  // until then the refusal's own wait is the whole reaction.
  if (current === null) return;
  entry.prConcurrency = loweredConcurrency(current, reaction);
};

/** The limit reading the record last gave this board, in the shape rules read. */
const limitReadingOf = (entry: PrState): LimitReading => {
  return {
    connector: entry.backend ?? '',
    bucket: '',
    limit: entry.prLimit,
    remaining: null,
    resetAt: entry.prResetAt,
    basis: entry.prLimitBasis,
  };
};

/**
 * The cap this board runs at right now — the connector's proposal, floored by
 * every refusal it has already caused.
 *
 * RECOMPUTED ON EVERY REFRESH RATHER THAN STORED, because the connector's
 * reading moves and the correction does not. Storing the composed number would
 * let a stale proposal outlive the reading it came from, and the composition is
 * `concurrencyBound`'s one line.
 *
 * @param entry - the cache entry holding the reading and the correction.
 * @returns the bound, or null where nothing licenses one.
 */
export const prConcurrencyBound = (entry: PrState): number | null => {
  return concurrencyBound(boundFromLimit(limitReadingOf(entry)), entry.prConcurrency);
};

/**
 * How long to leave between PR refreshes on a given backend, in ms.
 *
 * The cadence with the cost put back into it. `PR_REFRESH_MS` is a budget
 * stated in the wrong unit — refreshes — and this converts it to the unit the
 * host actually meters: requests. One refresh costs
 * `PR_REQUESTS_PER_REFRESH[backend]` requests, so spacing refreshes that many
 * periods apart spends the same number of requests per hour on every host.
 *
 *     github      60_000 x 1 =  60_000 ms  ->  60 refreshes,  60 requests / hour
 *     bitbucket   60_000 x 4 = 240_000 ms  ->  15 refreshes,  60 requests / hour
 *
 * DERIVED, NOT CONFIGURED, and the plan's open point is answered that way on
 * purpose: a configured cadence is a second number that must be kept true, and
 * this one follows from a fact the adapter already states. The multiplier is
 * read from the CONFIGURED backend — `plot-host.sh backend`, which reads
 * `PLOT_HOST` or the `Git host` config key and touches no network — never from
 * counting responses. Inferring it per request would make the cadence depend on
 * the very calls it is rationing.
 *
 * **A GitHub board is unchanged.** The multiplier is 1 there, so this returns
 * exactly `PR_REFRESH_MS` and every arithmetic downstream of it is the same
 * number it was. The uncommon case must not slow the common one down.
 *
 * The trade is stated rather than hidden: a Bitbucket board's PR badges are up
 * to four minutes old instead of one. That is the right side to err on for
 * data whose events are minutes-scale anyway — and the alternative is not a
 * fresher board but a rate-limited one, which is how this was measured.
 *
 * **AND THE ACCOUNT-LEVEL TERM, WHICH THE COST MULTIPLIER ALONE CANNOT SUPPLY.**
 * The arithmetic above is right for ONE board. A second board on the same
 * account doubles what the account spends, because neither board can see the
 * other. So the interval also divides by what the record says the account is
 * observed to be spending: two boards each refresh half as often and the pair
 * still spends 60 requests an hour, a third makes it a third each and the total
 * is unchanged again.
 *
 * NO PEER COUNTING. The rate is read from the record rather than from a
 * headcount, because the operator's own `gh` calls and a dispatched worker's
 * scans spend the same budget — a count of boards would miss both, and a count
 * of processes would miss the person at the terminal. `cadenceStretch` is where
 * that division lives; this function supplies the two numbers it needs and
 * holds no copy of the reasoning.
 *
 * **A QUIET ACCOUNT IS UNCHANGED, AND SO IS A BOARD THAT ASKS NOTHING.** Every
 * caller that passes no rate — every existing one — gets exactly the number it
 * got before, and so does a board whose record holds an absent rate. The
 * uncommon case must not slow the common one down.
 *
 * @param backend - the configured host, which decides what one refresh costs.
 * @param rate - what the record says this account is spending, or null where it
 *   was not read or holds no rate to read. Null leaves the cadence exactly where
 *   the cost multiplier alone puts it.
 * @param currentMs - the interval this board is refreshing at right now, which
 *   is what lets it subtract its own contribution from the observed rate.
 *   Defaults to the unstretched interval, which is where a board starts.
 */
export const prRefreshMsFor = (
  backend: string,
  rate: { perHour: number | null } | null = null,
  currentMs?: number,
): number => {
  const cost = prRequestsPerRefresh(backend);
  return refreshIntervalMs(PR_REFRESH_MS, cost, rate, currentMs ?? PR_REFRESH_MS * cost);
};

/**
 * What the budget record says this account is spending, or null.
 *
 * ASKED OF `plot-host.sh spend-rate`, WHICH SPENDS NOTHING. It reads the file
 * every spender on this computer appends to and asks no host — which is the
 * whole reason the record exists rather than a `rate_limit` call per decision.
 * Measured 2026-09-01, `rate_limit` reported 5000 while the response headers
 * read 0, so the call would be both metered and wrong.
 *
 * ONE LOCAL `bash` PER REFRESH, on the 60 s clock rather than the 5 s one. That
 * is the same seam `pr-list` already goes through, so a fixture `Scripts` that
 * substitutes one substitutes both.
 *
 * NULL ON EVERY FAILURE, and that direction is deliberate. An unreadable record,
 * an absent script and a torn line all mean the same thing here — *no evidence*
 * — and no evidence must leave the cadence where it is. Reading silence as a
 * busy account would let a missing file slow every board down; reading it as an
 * idle one would be the dishonest input the record exists to remove, and the
 * `perHour: null` the script returns for a window with no span carries exactly
 * that distinction through untouched.
 */
const spendRateFor = async (
  scripts: Scripts,
): Promise<{
  perHour: number | null;
  resetAt: number | null;
  limit: number | null;
  basis: LimitBasis;
  account: string | null;
} | null> => {
  try {
    const said = await scripts.hostSaid(['spend-rate']);
    if (said.answer !== 'answered') return null;
    const parsed: unknown = JSON.parse(said.stdout);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const perHour = (parsed as { perHour?: unknown }).perHour;
    // THE RESET THE HEADERS CARRIED, read back out of the record rather than
    // asked of `gh api rate_limit` — free where that call is metered, and right
    // where it was measured wrong. An older `plot-budget.sh` omits the field
    // entirely, which reads as null: no reset known, which is exactly what a
    // record that never stored one means.
    const resetAt = (parsed as { resetAt?: unknown }).resetAt;
    // THE CEILING AND THE ACCOUNT COME FROM THE SAME READ, so the concurrency
    // bound costs no extra host request and no extra `bash`. `spend-rate`
    // already reports both — the limit the response headers carried and the
    // account `budget_account` resolved — and asking twice would be a second
    // shell per refresh answering about a different moment.
    const limit = (parsed as { limit?: unknown }).limit;
    const basis = (parsed as { basis?: unknown }).basis;
    const account = (parsed as { account?: unknown }).account;
    return {
      perHour: typeof perHour === 'number' && Number.isFinite(perHour) ? perHour : null,
      resetAt: typeof resetAt === 'number' && Number.isFinite(resetAt) ? resetAt : null,
      limit: typeof limit === 'number' && Number.isFinite(limit) ? limit : null,
      // AN UNRECOGNISED BASIS IS `unknown`, NEVER A GUESS. A record written by a
      // newer Plot could name a fourth word, and reading it as `actual` would
      // let an unrecognised value license a bound — the direction that spends.
      basis: basis === 'actual' || basis === 'predicted' ? basis : 'unknown',
      account: typeof account === 'string' && account !== '' ? account : null,
    };
  } catch {
    return null;
  }
};

/**
 * Holds one of the account's slots for the duration of a host call.
 *
 * **THE POPULATION IS PROCESSES, NOT PROMISES**, which is why the count lives
 * in a directory beside the budget record rather than in a variable here.
 * 2026-08-27 was eight WORKERS, each shelling `plot-host.sh` once, and this
 * board's own refresh is sequential — so a semaphore inside this process would
 * bound nothing that incident measured.
 *
 * **AT THE CAP IT WAITS, AND THE WAIT IS THE DEGRADED CADENCE.** The plan's
 * Done-when is that more spenders than the cap degrades cadence rather than
 * producing a 403, and waiting for a peer to finish is exactly that: the call
 * still happens, later. It is not a backoff and must not become one — a caller
 * waiting for a slot is waiting for a peer, not for a limit to reset, and
 * `reactionTo` owns the other question.
 *
 * **AND A WAIT THAT RUNS OUT PROCEEDS RATHER THAN REFUSING.** A board that
 * waited forever would read as broken instead of busy. Every slot being held
 * that long means every holder is stuck or the reading is wrong, and the cost
 * of one extra simultaneous call is a secondary refusal that lowers the bound —
 * evidence, arriving through the mechanism this whole slice is built on.
 *
 * **AN UNREADABLE SLOT DIRECTORY SPENDS.** This is the one place the answer is
 * deliberately permissive: a board that stopped asking because a directory
 * could not be created would go dark on a disk fault, and the cap exists to
 * prevent a 403, not to become a second way to fail.
 *
 * @param entry - the cache entry holding the account and the bound.
 * @param call - the host call to make while the slot is held.
 * @returns whatever `call` returned.
 */
const liveSlotsFor = async (entry: PrState): Promise<number | null> => {
  const account = entry.prAccount;
  if (account === null) return null;
  const answer = await slotsFile().held(account);
  if (!answer.ok) return null;
  // A STALE CLAIM IS NOT A HELD SLOT, and the rule decides which is which. The
  // board reports the same count the gate counts, or the number on screen would
  // disagree with the one the cap acted on.
  return heldSlots(
    answer.value.map((slot) => ({
      claim: slot.claim,
      alive: pidLooksAlive(slot.claim.pid),
      startedAt: null,
    })),
    Date.now(),
  );
};

/**
 * Whether a pid is alive, for the REPORTED count.
 *
 * The gate's own liveness test lives in the adapter, where it belongs; this is
 * the same question asked for a number nobody spends against, so it is asked
 * the same way rather than through a second mechanism that could disagree.
 */
const pidLooksAlive = (pid: number): boolean | null => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return null;
  }
};

export const withHostSlot = async <T>(entry: PrState, call: () => Promise<T>): Promise<T> => {
  const bound = prConcurrencyBound(entry);
  const account = entry.prAccount;
  // NOTHING LICENSES A BOUND, so nothing is claimed. A board that has read no
  // limit runs as it did before this slice, and the first reading changes that.
  if (bound === null || account === null) return call();
  const slots = slotsFile();
  const startedAt = Date.now();
  let index: number | null = null;
  for (;;) {
    const asked = await slots.acquire(account, bound);
    if (!asked.ok) break;
    if (asked.value !== null) {
      index = asked.value;
      break;
    }
    // `wait`, WHICH IS NEVER *NOTHING TO DO*. The verdict is recomputed rather
    // than assumed so the rule owns the word, and a caller reading this can see
    // that a full account and an unreadable one are different answers.
    if (slotVerdict(bound, bound) !== 'wait') break;
    if (waitExhausted(Date.now() - startedAt)) break;
    await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_MS));
  }
  try {
    return await call();
  } finally {
    // RELEASED ON EVERY EXIT, thrown or returned. A refusal is thrown through
    // this on purpose — the catch that owns the backoff is further out — and a
    // slot leaked on that path would lower the account's real cap by one for
    // ten minutes, which is the staleness bound rather than a fault anybody
    // would notice.
    if (index !== null) await slots.release(account, index);
  }
};

/**
 * What one refresh costs on `backend`, in host requests.
 *
 * An unknown backend costs 1 — see `PR_REQUESTS_PER_REFRESH`. Never 0, which
 * would make `prRefreshMsFor` return 0 and turn the gate into a tight loop: the
 * one arithmetic here that fails dangerously rather than merely wrongly.
 */
export const prRequestsPerRefresh = (backend: string): number => {
  const cost = PR_REQUESTS_PER_REFRESH[backend];
  return cost && cost > 0 ? cost : 1;
};

/**
 * How far before `prNextAt` an ordinary cadence tick may still be honoured, in
 * ms. Two percent of the period — 1.2 s at the 60 s cadence.
 *
 * This exists because the timer and the gate are separate clocks that are meant
 * to agree, and `setInterval` does not promise they will to the millisecond. A
 * tick that arrives a hair EARLY is the tick this period is entitled to; with an
 * exact `<` comparison it is refused, and — because the interval is rigid — the
 * next one is a whole period later. That is the 111 s-against-60 s defect this
 * constant closes, arriving by a different route: measuring from the fetch's
 * start removes the systematic drift, and this absorbs the residual jitter that
 * would otherwise reopen it one tick at a time.
 *
 * Deliberately small. It is a tolerance on a clock, not a licence to fetch
 * sooner, and it is applied ONLY to the ordinary cadence — never to a rate-limit
 * backoff, which is a floor the host named and this must not shave. See
 * `prGateOpen`.
 *
 * ABSOLUTE, and deliberately not scaled by the host cost multiplier. It answers
 * "how far can `setInterval` miss its mark", which is a property of the timer
 * and not of the period the gate is aiming at — the timer still fires every
 * `PR_REFRESH_MS` on every host. Scaling it would widen the tolerance on
 * exactly the host that can least afford an early call: 3.6 s of licence to
 * fetch on Bitbucket, bought for jitter that is still measured in
 * milliseconds. Left absolute, a stretched cadence is proportionally STRICTER
 * than the 60 s one, which is the safe direction for a change whose whole
 * purpose is to spend less.
 */
const PR_TICK_SLACK_MS = PR_REFRESH_MS / 50;

/**
 * Whether the PR fetch may run now.
 *
 * The gate is load-bearing and nothing bypasses it: it is what turns a rate
 * limit into a wait rather than a tighter loop. But it answers two different
 * questions with one number, and they need different strictness:
 *
 * - **an ordinary cadence target** (`hard: false`) — "the next refresh is due
 *   here". The timer is trying to hit this, so a tick landing fractionally
 *   early is honoured rather than thrown away for a full period.
 * - **a floor the host named** (`hard: true`) — "do not call before here". A
 *   rate-limit backoff is a promise made to the host and is compared exactly,
 *   with no slack whatsoever.
 *
 * Splitting them is the point. A single tolerance wide enough to absorb timer
 * jitter is also wide enough to fire a second before a 61 s reset, which spends
 * quota to be refused — the precise thing the backoff exists to prevent.
 */
export const prGateOpen = (
  nextAt: number, hard: boolean, now = Date.now(),
): boolean => {
  if (hard) return now >= nextAt;
  return now + PR_TICK_SLACK_MS >= nextAt;
};

/**
 * When the PR fetch is next due, given when this one STARTED and how it ended.
 *
 * The one place the cadence's anchor is chosen, extracted so the choice is
 * testable as arithmetic rather than only observable through a live 60 s timer.
 * `refreshPrs` calls this and stores what it returns; there is no second copy.
 *
 * @param startedAt when the fetch that just ended began — the anchor for the
 *   ordinary cadence, and the fix for the defect this function is named after.
 *   Anchoring to the finish instead cost a whole period per cycle.
 * @param backoff a rate-limit wait the host named, or null for success and for
 *   ordinary failures, both of which rejoin the ordinary cadence.
 * @param now the moment the fetch ended — a named backoff is measured from
 *   here, because the host's clock started when it answered, not when we asked.
 * @param backend the CONFIGURED host, which decides what one refresh costs and
 *   therefore how far apart refreshes go. Defaults to `github`, whose cost is
 *   1, so every existing caller and every existing test gets exactly the
 *   arithmetic it got before.
 * @param rate what the budget record says the ACCOUNT is spending, or null
 *   where it was not read. Defaults to null, which leaves the cadence exactly
 *   where the cost multiplier alone puts it — so, again, every existing caller
 *   gets the arithmetic it got before.
 * @param currentMs the interval this board is refreshing at right now, which is
 *   what lets it subtract its own contribution from the observed rate.
 */
export const prNextDueAt = (
  startedAt: number, backoff: number | null, now = Date.now(),
  backend = 'github',
  rate: { perHour: number | null } | null = null,
  currentMs?: number,
): { at: number; hard: boolean } => {
  // BEFORE the cost is applied, and this ordering is the rule the brief names:
  // a cost-aware cadence may only ever be MORE conservative than a backoff,
  // never less. The host named this floor; stretching it would be conservative
  // and harmless, but shortening it would spend quota to be refused — so the
  // backoff is returned untouched and the multiplier never reaches it.
  if (backoff !== null) return { at: now + backoff, hard: true };
  return { at: startedAt + prRefreshMsFor(backend, rate, currentMs), hard: false };
};

/**
 * The configured git host, asked ONCE per cache entry and cached for the
 * process's life.
 *
 * `plot-host.sh backend` reads `PLOT_HOST` or the `Git host` config key and
 * touches no network — 22 ms, entirely local, so this is safe on a timer and
 * safe beside `no-network.test.ts`'s rule. It is asked once anyway because the
 * answer is configuration: it changes when a human edits `CLAUDE.md`, and a
 * board that outlives that edit is a board that has been restarted.
 *
 * A failure resolves to `github`, the cost-1 default. The consequence of
 * guessing wrong in that direction is the cadence this file had yesterday, and
 * the consequence of guessing wrong in the other is a board that refreshes
 * three times slower than it needs to on the host where freshness is cheap.
 * The error is not surfaced because there is nothing for a reader to do about
 * it: unlike a PR fetch, this failing produces no wrong CLAIM on the page.
 */
export const resolveBackend = async (
  entry: PrState, host: Host,
): Promise<string> => {
  if (entry.backend !== null) return entry.backend;
  try {
    const answer = await host.backend();
    entry.backend = answer.ok ? answer.value : 'github';
  } catch {
    entry.backend = 'github';
  }
  // Both arms above assign a string, so this is non-null; the narrowing is lost
  // across the try/catch rather than the value being genuinely unknown.
  return entry.backend ?? 'github';
};

/**
 * Records when the PR fetch is next due, and what interval that implies.
 *
 * ONE PLACE, THREE EXITS. `refreshPrs` leaves by a success, an all-unknown
 * outage and a thrown refusal, and all three must reschedule identically — a
 * failure on a shared account must be spaced by the same division a success is,
 * or a board that is failing spends more than one that is working. Before this
 * existed the three exits held three copies of two assignments; a fourth field
 * would have made that three copies of three.
 *
 * `prIntervalMs` is stamped from the ORDINARY cadence even where a backoff
 * pushed `prNextAt` further out. The two answer different questions: the gate
 * says when this board may next call, and the interval says what this board is
 * spending, which is what the next division subtracts. A backoff is a one-off
 * wait the host named, so treating it as this board's rate would understate the
 * board's own contribution and over-stretch every board that reads the record
 * next.
 */
const scheduleNextPr = (
  entry: PrState, startedAt: number, backoff: number | null, backend: string,
  rate: { perHour: number | null } | null,
): void => {
  const interval = prRefreshMsFor(backend, rate, entry.prIntervalMs);
  const due = prNextDueAt(startedAt, backoff, Date.now(), backend, rate, entry.prIntervalMs);
  entry.prIntervalMs = interval;
  entry.prNextAt = due.at;
  entry.prNextIsBackoff = due.hard;
};

/**
 * THE PR STORE FOR ONE REPOSITORY, constructed here for `slotsFile`'s reason:
 * it is machine-local state rather than a fixture a caller substitutes, and a
 * board handed an in-memory one would keep a store no later process could
 * read — which is the entire point of having one. Seamed by
 * `PLOT_PR_INDEX_HOME`, which is how a test moves it and which keeps priority
 * over `repoRoot` because the adapter checks it first on every call.
 *
 * Cached per `repoRoot` rather than per-refresh so the `git rev-parse
 * --git-common-dir` lookup the adapter caches is made once per repository per
 * process rather than once a minute — and keyed by `repoRoot` rather than
 * module-level so one process holding entries for several repositories (keyed
 * by `repoRoot` and `scriptsDir` at `cacheKey`) writes each to its own store
 * instead of all of them to whichever repository started the process.
 */
const prStores = new Map<string, PrIndexStore>();

export const prStoreFor = (repoRoot: string): PrIndexStore => {
  const held = prStores.get(repoRoot);
  if (held !== undefined) return held;
  const created = prIndexFile({ cwd: repoRoot });
  prStores.set(repoRoot, created);
  return created;
};

/**
 * One host row reduced to what the store holds.
 *
 * **AN ABSENT FIELD STAYS ABSENT.** `refreshPrs` normalizes three fields to
 * three DIFFERENT absent values — `url` to `""`, `mergeable` to `"unknown"`,
 * `failing_checks` to `[]` — and each says something the others do not. This
 * copies whichever it was handed and invents no fourth: writing `false` or
 * `"none"` for a field the host never answered manufactures exactly the verdict
 * `an-unasked-host-is-not-an-absent-pr` exists to remove.
 *
 * @param pr - the record as the adapter reported and `refreshPrs` normalized it.
 * @returns the row to store.
 */
const storeRow = (
  pr: PrRecord, predecessor?: PrIndexRow, now: number = Date.now(),
): PrIndexRow => {
  const row: PrIndexRow = {
    number: pr.number,
    head: pr.head,
    state: pr.state,
    draft: pr.draft,
    checks: pr.checks,
    review: pr.review,
    url: pr.url,
  };
  // Each guarded separately and each on its own absent value, so a row the host
  // answered partially round-trips as partially answered.
  if (typeof pr.mergeable === 'string') row.mergeable = pr.mergeable;
  if (Array.isArray(pr.failing_checks)) row.failing_checks = pr.failing_checks;
  if (typeof pr.updatedAt === 'string' && pr.updatedAt !== '') row.updatedAt = pr.updatedAt;
  if (typeof pr.author === 'string' && pr.author !== '') row.author = pr.author;
  if (typeof pr.checksSha === 'string' && pr.checksSha !== '') row.checksSha = pr.checksSha;
  if (typeof pr.mergedAt === 'string' && pr.mergedAt !== '') row.mergedAt = pr.mergedAt;
  if (typeof pr.headSha === 'string' && pr.headSha !== '') {
    row.headSha = pr.headSha;
    // THIS MACHINE'S CLOCK: carried while the head is the one last seen, reset
    // when it moves. With no predecessor the head is first seen now.
    row.headSince = predecessor?.headSha === pr.headSha && predecessor.headSince !== undefined
      ? predecessor.headSince
      : new Date(now).toISOString();
  }
  return row;
};

/**
 * One stored row back in the shape the board's maps hold.
 *
 * The inverse of `storeRow`, and absence survives the round trip in both
 * directions: a row stored without `mergeable` comes back without it, and the
 * caller normalizes it exactly as it normalizes a host row that omitted it. A
 * value invented here would be indistinguishable from one the host answered.
 *
 * @param row - the row as the store holds it.
 * @returns the record the board's maps hold.
 */
const recordOf = (row: PrIndexRow): PrRecord => {
  const pr: PrRecord = {
    number: row.number,
    head: row.head,
    state: row.state,
    draft: row.draft,
    checks: row.checks,
    review: row.review,
    url: row.url,
  };
  if (row.mergeable !== undefined) pr.mergeable = row.mergeable;
  if (row.failing_checks !== undefined) pr.failing_checks = row.failing_checks;
  if (row.updatedAt !== undefined) pr.updatedAt = row.updatedAt;
  if (row.author !== undefined) pr.author = row.author;
  if (row.headSha !== undefined) pr.headSha = row.headSha;
  if (row.headSince !== undefined) pr.headSince = row.headSince;
  if (row.checksSha !== undefined) pr.checksSha = row.checksSha;
  if (row.mergedAt !== undefined) pr.mergedAt = row.mergedAt;
  return pr;
};

/**
 * Seeds the entry's PR maps from the store, where it holds anything and the
 * entry holds nothing.
 *
 * **THIS IS WHAT A RESTART BUYS, and it is the whole of this slice's own
 * measurable win.** The host call is unchanged — still `--state all --limit
 * 1000` — so the store cannot make it cheaper here. What it can do is stop the
 * board being blank for the 29 811 ms the call takes: a process that has just
 * started renders the last answer immediately and replaces it when the host
 * speaks.
 *
 * **IT REFUSES TO OVERWRITE A LIVE MAP.** `prsByNumber !== null` means this
 * process has already heard from the host, and disk is older than that by
 * construction. Seeding over it would move the board backwards on every
 * refresh.
 *
 * **`prAt` IS NOT STAMPED.** It answers *how old is this data*, and the answer
 * for a seeded map is *as old as the store*, not *now*. `prAgeSeconds` is what
 * the operator reads to decide whether to trust the screen, so stamping it here
 * would report stale rows as fresh — the one lie this path could tell.
 *
 * @param entry - the cache entry to seed.
 * @param connector - which connector's store to read.
 * @param store - the repository's PR store.
 */
export const seedPrsFromStore = async (
  entry: PrState, connector: string, store: PrIndexStore,
): Promise<void> => {
  if (entry.prsByNumber !== null) return;
  let held;
  try {
    held = await store.read(connector);
  } catch {
    return;
  }
  // A missing, unparseable or unrecognised store answers `null`, and an
  // unreadable one answers `failed`. Both mean the same thing here: nothing to
  // seed from, so the board waits for the host exactly as it does today.
  if (!held.ok || held.value === null) return;
  applyPrMaps(entry, mapsOfRows(held.value.rows));
};

/** The three maps the board serves, derived from one set of rows. */
export interface PrMaps {
  /** Open PRs by head branch — what `classify` reads. */
  prs: Map<string, PrRecord>;
  /** Every PR by number, whatever its state. */
  byNumber: Map<number, PrRecord>;
  /** One PR per head branch, ranked; every state, for the link. */
  byHead: Map<string, PrRecord>;
}

/**
 * Builds the three served maps from stored rows.
 *
 * **EXTRACTED SO THE DELTA PATH CAN REACH IT, and `seedPrsFromStore`'s guard
 * deliberately did not come with it.** That guard — `prsByNumber !== null` —
 * is what stops disk moving a live board backwards, and a delta path that
 * bypassed it would be one that could seed over live data too. So the guard
 * stays where it decides, and only the derivation moved.
 *
 * **THE THREE RULES ARE THE HOST PATH'S**, re-applied rather than shared by
 * accident: a stored row reaches these maps under exactly the conditions a
 * fetched one does, or a board served from the store would classify branches by
 * a rule the refreshed board does not use.
 *
 * @param rows - the rows to derive from, as the store holds them.
 * @returns the three maps.
 */
export const mapsOfRows = (rows: readonly PrIndexRow[]): PrMaps => {
  const prs = new Map<string, PrRecord>();
  const byNumber = new Map<number, PrRecord>();
  const byHead = new Map<string, PrRecord>();
  for (const row of rows) {
    const pr = recordOf(row);
    if (pr.head && pr.state === 'OPEN') prs.set(pr.head, pr);
    byNumber.set(pr.number, pr);
    if (pr.head) {
      const ranked = byHead.get(pr.head);
      if (!ranked || prOutranks(pr, ranked)) byHead.set(pr.head, pr);
    }
  }
  return { prs, byNumber, byHead };
};

/**
 * Puts one set of maps on the entry, as the three fields the board serves.
 *
 * One assignment site rather than three repeated at each caller: the maps are
 * always set together, and a path that set two of them would serve a board
 * whose `prs` and `prsByNumber` disagreed about which PRs exist.
 *
 * @param entry - the cache entry to fill.
 * @param maps - the maps to serve.
 */
export const applyPrMaps = (entry: PrState, maps: PrMaps): void => {
  entry.prs = maps.prs;
  entry.prsByNumber = maps.byNumber;
  entry.prsByHead = maps.byHead;
};

/**
 * Folds one answer into the store and writes it, reporting nothing upward.
 *
 * **EVERY FAILURE IS SWALLOWED, AND THAT IS THE CONTRACT.** A read-only
 * filesystem, a full disk and a store this Plot cannot parse must each cost the
 * board time and not answers — the caller carries on with the map it already
 * built. Surfacing a store failure as `prError` would put a local disk problem
 * into the banner that reports the HOST, and an operator would go looking at
 * GitHub.
 *
 * **CALLED ONLY WHERE THE HOST ANSWERED.** The `allUnknown` path and the
 * `catch` keep the last good map in memory and must leave the file alone for
 * the stronger version of the same reason: a dark map written to disk is
 * inherited by the next process as good data, where an in-memory one dies with
 * this one.
 *
 * **IT RETURNS WHAT IT FOLDED, AND THAT IS WHAT THE DELTA PATH SERVES.** The
 * fold is the one place a partial answer is merged with what was held, so the
 * caller building its maps from this return value gets the merge for free —
 * where building them from the pass's own rows would serve a 3-row window as
 * the whole estate. `null` where nothing could be folded or written, which the
 * caller reads as *fall back to the rows I have*.
 *
 * @param connector - which connector answered.
 * @param rows - the rows the host returned this pass.
 * @param complete - whether the answer covered every state asked about.
 * @param store - the repository's PR store.
 * @returns the store as it was folded and written, or null where it could not be.
 */
export const writePrStore = async (
  connector: string, rows: readonly PrIndexRow[], kind: PrAnswerKind, store: PrIndexStore,
): Promise<PrIndex | null> => {
  try {
    const held = await store.read(connector);
    // An unreadable store is merged into as if it were absent: a whole answer
    // replaces it anyway, and a partial one keeping nothing is the safe
    // direction — it under-claims rows rather than inventing them.
    const previous = held.ok ? held.value : null;
    const folded = foldPrIndex(previous, {
      connector,
      rows,
      kind,
      // THIS MACHINE'S CLOCK, AND ONLY FOR AN OPERATOR READING THE FILE. The
      // watermark is taken from the ROWS by `foldPrIndex` and never from here.
      at: new Date().toISOString(),
    });
    // THE FOLD IS RETURNED WHETHER OR NOT THE WRITE LANDED. A read-only disk
    // must cost the board time and not answers, and the merged view is correct
    // in memory whatever the filesystem did with it — refusing to serve it
    // because the write failed would turn a disk problem into a wrong board.
    await store.write(connector, folded);
    return folded;
  } catch {
    // The adapter answers with values rather than throwing, so reaching this is
    // a bug rather than a disk. It is still swallowed: the store may cost the
    // board time and may never cost it an answer.
    return null;
  }
};

// EXPORTED SO THE STORE'S REFUSALS CAN BE ASSERTED. Four of them — the
// `allUnknown` path leaving the file untouched, the `catch` leaving it
// untouched, a partial answer merging, a failed write costing nothing — are
// about what this function does NOT do, and a test driving it through the
// cadence gate would prove only that the gate was shut.
export const refreshPrs = async (world: PrWorld, entry: PrState): Promise<void> => {
  // Captured BEFORE the call, and this is the whole fix. `prNextAt` is the
  // cadence's anchor, and anchoring it to the finish made every period cost the
  // call's duration — the tick meant to satisfy it arrived just too early, was
  // refused, and the next one came a period later. Anchoring to the start makes
  // the gate open exactly when the rigid interval tick arrives.
  //
  // `prAt` still stamps at the finish: it answers "how old is this DATA", and
  // data is not fetched until it has landed. Two questions, two stamps — the
  // one place they were the same number is the defect.
  const clock = world.now ?? Date.now;
  const startedAt = clock();
  // Before the fetch, so BOTH exits have it — a failure reschedules too, and a
  // failure on Bitbucket must be spaced by the same cost as a success. Cached
  // after the first call, so this is one extra local `bash` on the process's
  // first refresh and nothing on any later one.
  // ONE ADAPTER PER SERVICE FOR THE WHOLE REFRESH, bound here and passed down.
  // `resolveBackend` defaults to `hostFor(opts)`, so leaving it to its default
  // would construct two adapters for one refresh — and a fixture `Host` handed
  // to only one of them would be obeyed by half the pass, which is the failure
  // a substitutable port exists to prevent.
  const { host, scripts, store: prStore } = world;
  // RESOLVED ONCE PER PASS, from the entry's own repository. A store built per
  // call would fork `git rev-parse --git-common-dir` for every read and write
  // below; `prStoreFor` caches it per `repoRoot` for the life of the process.
  // THE CI CONNECTOR IS SEPARATE, and resolved beside the host rather than
  // from it. A team whose code is on Bitbucket and whose builds run on Jenkins
  // has two services; asking one for the other's answers is what left that
  // team's check column ABSENT rather than wrong.
  const backend = await resolveBackend(entry, host);
  // Read BEFORE the fetch, so all three exits divide by the same number and a
  // failure is spaced exactly as a success is. Reading it after would also
  // count this refresh's own line, which the board is about to subtract anyway.
  const rate = await spendRateFor(scripts);
  // Held for the banner, which needs the SAME number the cadence divided by.
  // Reading it again in the payload would be a second `bash` per refresh and a
  // different answer whenever a line landed between the two reads.
  entry.prSpendPerHour = rate?.perHour ?? null;
  // Held for the same reason and from the same read: a refusal in either branch
  // below needs a reset to wait for, and asking again would be a second `bash`
  // per refresh answering a different moment.
  entry.prResetAt = rate?.resetAt ?? null;
  // THE CEILING AND THE ACCOUNT THE CAP IS KEYED BY, from the same read. A
  // record that could not be read leaves them where they were rather than
  // clearing them: silence is not evidence that the connector's limit changed,
  // and clearing the account would silently unbound the board.
  if (rate !== null) {
    entry.prLimit = rate.limit;
    entry.prLimitBasis = rate.basis;
    entry.prAccount = rate.account;
  }
  // THE EVIDENCE, READ WHERE IT IS FREE. Counting the claims is one `readdir`
  // and no host request, and it is taken here rather than in the payload
  // assembly so the number the banner shows is the one this refresh gated on.
  // A cap that refuses nothing and reports nothing is indistinguishable from no
  // cap at all.
  entry.prSlotsHeld = await liveSlotsFor(entry);
  // READ BEFORE THE CALL, and this is the half of the store a restart feels.
  // A cold process renders the last answer the host gave rather than nothing
  // for the 29 811 ms the call takes. It seeds only an EMPTY entry, so a board
  // that has already heard from the host is never moved backwards by disk.
  //
  // Outside the `try` because it is not the host: a store that cannot be read
  // must not reach the catch that owns the backoff and the banner, which report
  // the connector. It swallows its own failures for the same reason.
  await seedPrsFromStore(entry, backend, prStore);
  // THE WINDOW, DECIDED BEFORE THE CALL AND FROM THE STORE THE CALL WILL FOLD
  // INTO. A second read is one local `readFile` against a host call measured at
  // 29 811 ms, and reading it here rather than reusing the seed's read is what
  // makes the window right on a warm entry: `seedPrsFromStore` returns
  // immediately once this process has heard from the host, so its read never
  // happens on the passes that matter most.
  //
  // OUTSIDE THE `try`, like the seed above it and for the same reason: a store
  // that cannot be read is not the host, and must not reach the catch that owns
  // the backoff and the banner. An unreadable store answers `null` here, which
  // `prWindowFor` reads as *ask for everything* — today's call exactly.
  let stored: PrIndex | null = null;
  try {
    const held = await prStore.read(backend);
    stored = held.ok ? held.value : null;
  } catch {
    stored = null;
  }
  // THE FAILED FULL READ IS A READING, AND IT COMES FROM THIS PROCESS. The
  // domain takes readings as values and never reaches a port, so the entry's
  // own observation is handed in rather than looked up. A fresh process has
  // seen no failure and keeps today's cadence exactly.
  const storedByNumber = new Map((stored?.rows ?? []).map((row) => [row.number, row] as const));
  const failedFullRead = entry.prFullReadFailedAt === null
    ? null
    : { at: entry.prFullReadFailedAt };
  const window = prWindowFor(
    stored, Date.now(), PR_FULL_READ_MS, failedFullRead, PR_FULL_READ_GRACE_MS,
  );
  try {
    // BOUNDED HERE, WHERE THE CALL IS. The gate wraps the host request and
    // nothing else — reading the record, parsing the answer and scheduling the
    // next refresh spend no host budget, and holding a slot across them would
    // count this board as a caller while it is not calling.
    //
    // `--since` IS APPENDED ONLY WHERE THERE IS A WINDOW, and never with an
    // empty value. A cold store, a store carrying no watermark and a store due
    // its full read each answer `since: null` here, and the call that goes out
    // is byte-identical to the one this file has always made. `--since ""`
    // would reach GitHub as `--search "updated:>"`, a syntax error the host may
    // answer with everything or with nothing.
    // `--rich-open` ON THE FULL READ AND `--rich` ON THE DELTA, and the window
    // is what tells them apart. A full read asks about a history that is almost
    // entirely terminal — measured 2026-10-01, all 1000 rows were (964 `MERGED`,
    // 36 `CLOSED`, 0 `OPEN`) — so asking a verdict of each cost 36 s of a 43 s
    // call for answers about heads nobody can act on. A DELTA ASKS ABOUT THE
    // ROWS THAT CHANGED, which is exactly the population whose verdicts are
    // worth buying: it answered 0 rows in 0.8 s, so there is nothing to save and
    // a changed terminal PR is one whose checks a reader may still be reading.
    //
    // STILL ONE `pr-list` CALL PER REFRESH, so `PR_REQUESTS_PER_REFRESH` needs
    // no new arithmetic — the adapter makes two host calls inside the one
    // question, and the budget counts questions.
    const args = ['pr-list', window.since === null ? '--rich-open' : '--rich',
      '--state', 'all', '--limit', String(PR_LIMIT)];
    if (window.since !== null) args.push('--since', window.since);
    const said = await withHostSlot(entry, () => scripts.hostSaid(args));
    // A refusal is thrown so the catch below keeps owning the backoff. It is one
    // policy — keep the last good map, wait where the host named a wait — and
    // the two paths that reach it (a refused call, and a map that came back all
    // `unknown`) must not grow two copies of it.
    //
    // A PARTIAL ANSWER IS NOT A REFUSAL. `bb pr list` has no `all` state, so
    // the Bitbucket arm asks once per state and may reach some and not others;
    // the rows that arrived are real PRs and dropping them is #912 — nine
    // branches reading `commits, no PR ever opened` while two had live ones.
    // Reported on 2026-09-15 by an operator whose reading was *"a reader
    // cleaning up stale branches would delete work that is under review."*
    //
    // IT IS STILL SAID. The rows are used AND the sentence naming the missing
    // states is kept, because a short list reported as whole is the quiet wrong
    // answer this path refuses everywhere else.
    if (said.answer !== 'answered' && said.answer !== 'partial') throw new Error(said.said);
    const out = said.stdout;
    const partialSaid = said.answer === 'partial' ? said.said : null;
    const map = new Map<string, PrRecord>();
    const byNumber = new Map<number, PrRecord>();
    const byHead = new Map<string, PrRecord>();
    // THE STORE'S ROWS, COLLECTED FROM THE SAME PARSE. A second pass over
    // `byNumber` would be the same rows by a different route, and `byHead`
    // holds one PR per branch by design — reading the store off it would flatten
    // a branch's several PRs into its newest, which is the `--limit 1` defect
    // `plot-pr-merged.sh` measured.
    const rows: PrIndexRow[] = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const pr = JSON.parse(line) as PrRecord;
      // `url` is new to --rich. An older shipped adapter omits it, so it is
      // normalized to "" here rather than left undefined — one absent-value
      // shape for every consumer to check.
      if (typeof pr.url !== 'string') pr.url = '';
      // `mergeable` is newer still, and its absent value is `unknown` rather
      // than "": the field answers a three-way question, and an adapter that
      // cannot answer it is in exactly the position Bitbucket is in. Normalized
      // here so `prState` never has to distinguish "the adapter is old" from
      // "the host cannot say" — neither is a claim that the branch merges.
      if (typeof pr.mergeable !== 'string' || !pr.mergeable) pr.mergeable = 'unknown';
      // Newer still, and its absent value is [] rather than undefined — one
      // absent-value shape for every consumer, the rule the two above follow.
      // [] does NOT mean nothing failed: `checks` answers that, and an adapter
      // that cannot name the failures has not claimed there were none.
      if (!Array.isArray(pr.failing_checks)) pr.failing_checks = [];
      // Its absent value is "", the one `url` has: an unknown owner. The store
      // keeps no "" — `storeRow` omits it — so a stored row stays unanswered.
      if (typeof pr.author !== 'string') pr.author = '';
      // A merged or declined PR must NOT reach `classify` by head: it would
      // answer for a branch whose git state has already answered, and reopen a
      // question the merge closed. Numbers are indexed regardless — a link to a
      // merged PR is exactly what a delivered plan's card wants.
      if (pr.head && pr.state === 'OPEN') map.set(pr.head, pr);
      byNumber.set(pr.number, pr);
      // AFTER the three normalizations above and BEFORE the open-only filter
      // below: the store holds what the adapter said about every PR, in the
      // shape every consumer already checks, and it is keyed by number so a
      // merged PR is stored exactly as an open one is.
      rows.push(storeRow(pr, storedByNumber.get(pr.number), clock()));
      // EVERY state, for the link alone — see `prsByHead`. The open-only filter
      // above is right about `classify` and wrong about the address, so the row
      // reads its number from here instead of losing it to a merge.
      //
      // AN OPEN PR OUTRANKS A CLOSED ONE, and the highest number breaks a tie
      // among equals. A head can carry several PRs over its life — a closed
      // attempt and its reopened successor — and the row wants the live one.
      // Without the rank the answer would depend on the host's listing order,
      // which no adapter promises: `gh` sorts by number descending today, `bb`
      // says nothing at all.
      if (pr.head) {
        const held = byHead.get(pr.head);
        if (!held || prOutranks(pr, held)) byHead.set(pr.head, pr);
      }
    }
    // A COMPLETED CHECK DOES NOT TOUCH `updatedAt`, so a delta keyed on that
    // field never sees it — the PR sits `pending` on screen until the next
    // FULL read, as long as 24h (#1277). `window.since === null` means this
    // pass already asked `--rich-open` about every open PR, so the re-ask
    // would be the same question twice; it fires only on a delta.
    //
    // ONLY `OPEN` AND ONLY `pending` — `pendingOpenPrNumbers` is the same rule
    // a unit test proves against a held store with no I/O. MERGED/CLOSED rows
    // are terminal and are never re-asked even if stored as `pending`.
    if (window.since !== null) {
      const pending = pendingOpenPrNumbers(stored);
      // STUCK-PENDING BOUND: a PR whose check queue never runs would be
      // re-asked every delta forever. A number is asked again only while its
      // streak of "still pending, same updatedAt" answers is under the limit;
      // re-asked only while its streak (below) is under the limit.
      //
      // AFTER THE COUNT IS SPENT, TIME BOUNDS IT: a PR whose head is younger than
      // `Checks wait` is re-asked at most once per `PR_PENDING_REASK_SLOW_MS`,
      // because CI outlasts five minutes. `failing` is included — a re-run can
      // turn it green.
      const waitMs = world.checksWaitMs ?? PR_CHECKS_WAIT_MS;
      const askable = pending.filter((n) => {
        if ((entry.prPendingReaskStreak.get(n) ?? 0) < PR_PENDING_REASK_LIMIT) return true;
        const since = Date.parse(storedByNumber.get(n)?.headSince ?? '');
        return Number.isFinite(since) && startedAt - since < waitMs
          && startedAt - (entry.prReaskAt.get(n) ?? 0) >= PR_PENDING_REASK_SLOW_MS;
      });
      if (askable.length > 0) {
        try {
          for (const n of askable) entry.prReaskAt.set(n, startedAt);
          const reasked = await withHostSlot(
            entry, () => scripts.hostSaid(['pr-list', '--rich', '--state', 'open']),
          );
          // A REFUSAL OR A PARTIAL ANSWER IS TREATED AS NO ANSWER HERE, not as
          // the outer catch's failure. The primary call already answered this
          // pass; a re-ask that cannot be trusted simply leaves the stored
          // `pending` rows as they were; the delta-merge's "keep what it did
          // not see" rule carries them forward unchanged.
          if (reasked.answer === 'answered') {
            const stillPending = new Set(askable);
            for (const line of reasked.stdout.split('\n')) {
              if (!line.trim()) continue;
              const pr = JSON.parse(line) as PrRecord;
              if (!stillPending.has(pr.number)) continue;
              if (typeof pr.url !== 'string') pr.url = '';
              if (typeof pr.mergeable !== 'string' || !pr.mergeable) pr.mergeable = 'unknown';
              if (!Array.isArray(pr.failing_checks)) pr.failing_checks = [];
              if (typeof pr.author !== 'string') pr.author = '';
              if (pr.head && pr.state === 'OPEN') map.set(pr.head, pr);
              byNumber.set(pr.number, pr);
              rows.push(storeRow(pr, storedByNumber.get(pr.number), clock()));
              if (pr.head) {
                const held = byHead.get(pr.head);
                if (!held || prOutranks(pr, held)) byHead.set(pr.head, pr);
              }
              // STILL PENDING WITH THE SAME `updatedAt` IS NO PROGRESS: the
              // streak grows. Anything else — checks moved, or the PR itself
              // moved — clears it, so a PR that starts failing is asked about
              // again exactly as a fresh pending one would be.
              const storedRow = stored?.rows.find((row) => row.number === pr.number);
              const noProgress = (pr.checks === 'pending' || pr.checks === 'failing')
                && storedRow !== undefined && storedRow.updatedAt === pr.updatedAt
                && storedRow.checks === pr.checks && storedRow.headSha === pr.headSha;
              if (noProgress) {
                entry.prPendingReaskStreak.set(
                  pr.number, (entry.prPendingReaskStreak.get(pr.number) ?? 0) + 1,
                );
              } else {
                entry.prPendingReaskStreak.delete(pr.number);
              }
              stillPending.delete(pr.number);
            }
            // ASKED ABOUT AND ABSENT FROM THE ANSWER: the PR is gone from the
            // open listing (closed or merged between the two calls within this
            // one refresh). Nothing to merge — the primary call's own rows, or
            // the next delta, settle its terminal state.
            for (const number of stillPending) entry.prPendingReaskStreak.delete(number);
          }
        } catch {
          // THE SAME POLICY AS A REFUSAL ABOVE: keep the last good map, touch
          // neither `entry.prFullReadFailedAt` (gated on `window.kind ===
          // 'whole'`, which this never is) nor the stored `pending` rows. The
          // outer catch owns the primary call's backoff; this one owns its own
          // and stops here.
        }
      }
    }
    // CONTENT-BASED TRIGGER: an all-unknown PR map is the shape a quota failure
    // takes when gh returns successfully. The host answered, but every PR came
    // back `state: 'unknown'`, which is indistinguishable from "could not reach
    // the host" at this boundary — except that it does not throw.
    //
    // A SINGLE unknown among readable ones does NOT raise the banner (Done-when
    // item 2): one gap is a gap; this fires only when the WHOLE map is dark.
    // An EMPTY map is not evidence of an outage — it means no PRs exist.
    const allPrs = Array.from(byNumber.values());
    const allUnknown = allPrs.length > 0 && allPrs.every((pr) => pr.state === 'unknown');

    if (allUnknown) {
      // The outage path: keep the LAST GOOD map so rows stay classified as they
      // were, but record the failure so the banner fires. The rule is the same
      // one the catch already states — an empty map looks like state changing
      // rather than data missing — and this path is the content-based join of it.
      //
      // prAt is NOT updated: it stays at the last successful fetch, so
      // `prAgeSeconds` tells the reader how old the data on screen actually is.
      //
      // The message mirrors the rate-limit detection in the catch: a message
      // that names the condition lets `prNote` choose the right wording, and a
      // rate limit here gets the same backoff the catch would apply.
      const message = 'all PRs returned unknown — the host could not be reached';
      entry.prError = message;
      const reaction = hostReaction(message, rate?.resetAt ?? null);
      applyReaction(entry, reaction);
      scheduleNextPr(entry, startedAt, waitOf(reaction), backend, rate);
    } else {
      // The happy path: the host answered and at least some PRs are readable.
      //
      // THE DOMAIN DECIDES WHAT KIND OF ANSWER THIS WAS. This line held the
      // rule as `window.complete && partialSaid === null`, which could not
      // express a healthy delta as anything but not-whole: the window asked
      // about a slice of the history, every state answered, and the store was
      // then marked partial — so the next refresh refused to narrow and the
      // board made its 43 s full listing every second refresh.
      //
      // THE TWO FACTS ARE STILL TWO FACTS. `window.kind` says *was this a full
      // read*; `partialSaid` says *did every host state answer*, a Bitbucket
      // shape since `bb` has no `all` state and its arm calls once per state.
      // `answerKind` maps the pair to one of three words rather than folding
      // them into a boolean that can only hold one of them.
      const kind = answerKind(window, partialSaid);
      // A FULL READ THAT ANSWERED CLEARS THE LATCH. The grace exists to stop a
      // failed full read repeating every 60 s; once one succeeds there is
      // nothing left to stand down, and a latch nobody clears would shorten the
      // next failure's grace to nothing.
      if (kind === 'whole') entry.prFullReadFailedAt = null;
      // THE SERVED MAPS COME FROM THE FOLD, NOT FROM THIS PASS'S ROWS. A
      // delta's window returns the rows that changed — 3 on a quiet estate —
      // and `map`/`byNumber`/`byHead` above hold exactly those. Serving them
      // would report 930 branches as having no PR while the store on disk is
      // perfectly correct, which is the defect a test asserting only the
      // store's contents would pass straight through.
      //
      // `writePrStore` returns what `foldPrIndex` merged, so the merge happens
      // once and in the rule that owns it rather than a second time here.
      //
      // THE STORE IS WRITTEN ON THIS PATH AND ON NO OTHER. The host answered
      // and at least some rows are readable, which is the only state in which
      // what is on disk should change. The `allUnknown` path and the `catch`
      // keep their map in memory and leave the file alone: a dark map written
      // to disk is inherited by the next process as good data.
      //
      // AWAITED, so a refresh cannot overlap its own write, so a test can
      // assert the file without racing it, and — since this slice — so the maps
      // it serves are derived from a fold that has already happened. The write
      // is one local `rename` against a host call measured at 29 811 ms.
      const folded = await writePrStore(backend, rows, kind, prStore);
      // A FULL READ SERVES ITS OWN ROWS, and that is not merely an
      // optimisation: a whole answer REPLACED the store, so the fold and this
      // pass hold the same rows by construction. Deriving from the fold anyway
      // would make a board whose disk write failed serve nothing.
      //
      // A DELTA FALLS BACK TO ITS OWN ROWS ONLY WHERE THE FOLD IS ABSENT, which
      // means the store could neither be read nor written. That board is
      // already in the state this whole path exists to avoid, and serving the
      // window's rows is the last honest thing left: they are what the host
      // just said.
      //
      // THE TEST IS THE ANSWER'S KIND AND NEVER THE FOLDED STORE'S FLAG. Since
      // a delta now leaves a whole store whole, `folded.complete` is `true`
      // after a 0-row window — and serving this pass's rows on that would
      // report every other branch as having no PR. The kind describes the CALL,
      // which is the question being asked here; `complete` describes the FILE.
      if (kind === 'whole' || folded === null) {
        entry.prs = map;
        entry.prsByNumber = byNumber;
        entry.prsByHead = byHead;
      } else {
        applyPrMaps(entry, mapsOfRows(folded.rows));
      }
      // `map` RATHER THAN THE FOLDED OPEN PRS, deliberately. `refreshRuns` asks
      // the CI connector about the branches it is given, and a delta's job is
      // to ask about what CHANGED — handing it every open PR in the store would
      // undo the saving on the connector this slice never set out to narrow.
      await world.afterAnswer?.(map);
      entry.prAt = Date.now();
      scheduleNextPr(entry, startedAt, null, backend, rate);
      // THE ROWS ARE KEPT AND THE GAP IS STILL SAID. A partial answer reached
      // here because its rows are real; recording no error would report a page
      // missing a whole host state as a complete reading, which is the quiet
      // wrong answer this adapter refuses elsewhere. A whole answer clears the
      // field exactly as before.
      entry.prError = partialSaid;
    }
  } catch (err) {
    // Same rule as the pulse: a failure keeps the last good map rather than
    // blanking it. An empty PR map would quietly move every row back to its
    // git-only group, which looks like state changing rather than data missing.
    const message = err instanceof Error ? err.message : String(err);
    entry.prError = message;
    // A FAILED FULL READ IS RECORDED, AND ONLY A FULL READ. The next refresh
    // follows in 60 s and the full read is still due, so without this the
    // heaviest query on the estate repeats every minute — a 504 names no wait,
    // so `hostReaction` has nothing to slow the board with. A failed DELTA is
    // not recorded: it is the cheap call, and standing the full read down on it
    // would delay the one answer that sees a deleted PR for a failure that
    // costs nothing to retry.
    //
    // ON THE ENTRY AND NOT IN THE STORE: see `prFullReadFailedAt`. The store is
    // also deliberately untouched on this path, so a dark answer is never
    // inherited as good data.
    if (window.kind === 'whole') entry.prFullReadFailedAt = Date.now();
    // A rate limit is the one failure worth slowing down for: retrying at the
    // normal cadence spends quota to be told the same thing. Every other
    // failure keeps the ordinary rhythm — a VPN blip should recover in a
    // minute, not in two.
    // On GitHub a bare exhaustion message carries no reset, so hand the throttle
    // a way to ask `gh api rate_limit` — free, and it states the real reset. The
    // fetcher is consulted at most once, and only when the message names neither
    // a wait nor a stamp. Bitbucket has no such endpoint and passes none, so its
    // bare message keeps the ceiling exactly as before.
    // THE RESET COMES FROM THE RECORD. `gh api rate_limit` was measured
    // 2026-09-01 reporting 5000 while the response headers read 0, so the free
    // endpoint is the wrong authority; the record holds what the headers said.
    const reaction = hostReaction(message, rate?.resetAt ?? null);
    // A SECONDARY LIMIT LOWERS CONCURRENCY AND NEVER FREQUENCY. The interval is
    // untouched by every branch here — see `scheduleNextPr`, which stamps
    // `prIntervalMs` from the ordinary cadence whatever the wait.
    applyReaction(entry, reaction);
    // A backoff is measured from NOW — the host's "wait 90 seconds" starts when
    // it said so, not when we started asking. An ordinary failure rejoins the
    // ordinary cadence, so it anchors to the start like a success does; a
    // failed call should not push the next attempt out by its own duration.
    scheduleNextPr(entry, startedAt, waitOf(reaction), backend, rate);
  }
};

/**
 * Which of two PRs on ONE head branch the row should point at.
 *
 * Only ever asked where a head carries more than one — a closed attempt and the
 * PR that replaced it — which is uncommon but not rare, and answered by the
 * host's listing order until this function existed. That order is not a promise:
 * `gh` happens to sort by number descending and `bb` documents nothing, so the
 * row's link would have been decided by whichever adapter answered.
 *
 * OPEN FIRST, because it is the one a reader can still act on: a closed PR
 * outranking its live successor would send them to a dead page while the real
 * review sat one number away. Between two PRs in the same standing the higher
 * number wins — the later attempt is the current one.
 *
 * MERGED IS NOT RANKED ABOVE CLOSED, deliberately. Both are finished, both are
 * worth linking, and neither is more current than the other; the number decides
 * and it decides consistently, which is all this needs to do.
 */
export const prOutranks = (candidate: PrRecord, held: PrRecord): boolean => {
  const open = (pr: PrRecord) => pr.state === 'OPEN';
  if (open(candidate) !== open(held)) return open(candidate);
  return candidate.number > held.number;
};

/**
 * A store that reads through to another and keeps its writes in memory.
 *
 * A reader with no fleet running folds the host's answer without publishing it:
 * the next pass in the same process reads its own fold, and nothing reaches the
 * file the fleet owns.
 *
 * @param under - the store reads fall through to when nothing was written here.
 * @returns a store whose `write` never touches `under`.
 */
export const memoryOverlay = (under: PrIndexStore): PrIndexStore => {
  const held = new Map<string, PrIndex>();
  return {
    location: (connector) => under.location(connector),
    read: async (connector) => {
      const mine = held.get(connector);
      if (mine !== undefined) return { ok: true, value: mine };
      return under.read(connector);
    },
    write: async (connector, index) => {
      held.set(connector, index);
      return { ok: true, value: undefined };
    },
  };
};
