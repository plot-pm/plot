import { RELEASE_BRANCH } from '../contract/schema.js';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  BLOCKED_NOTE,
  blockedNote,
  DRAFT_PLAN_NOTE,
  ELIGIBLE_NOTE,
  FINISHED_PLAN_NOTE,
  FleetScanLineSchema,
  isLiveState,
  PR_UNKNOWN_NOTE,
  unknownPhaseNote,
  type AgentRow,
  type BranchState,
  type BriefState,
  type Fleet,
  type FleetReading,
  type FleetSprint,
  type IssueAnswer,
  type IssueRow,
  type MachineProcess,
  type PulseShrink,
  type RowKind,
  type StuckRun,
  type WaitingGroup,
  type WaitingOn,
  type Slice,
  type SliceVerdict,
  type WorkerState,
  type SprintCounts,
} from '../contract/schema.js';
import { stuckState, summarizeStuck } from './stuck.js';
import { repairFor, startRepair } from './resolver.js';
import { workingTreeSprints, planStatusBySlug, readConfigAsync, scriptsFor, treesFor, hostFor, type BuildBoardOptions } from './board.js';
import type { Host } from '@plot-pm/domain';
// The cadence division is a DOMAIN rule, not a board decision: `CLAUDE.md`
// settles that every rendered or wired state is a domain property, and this one
// is asserted as arithmetic in `packages/domain/test/cadence.test.ts` rather
// than only observable through a live 60 s timer.
import {
  SLOT_POLL_MS,
  boundFromLimit,
  concurrencyBound,
  heldSlots,
  localSpenders,
  loweredConcurrency,
  reactionTo,
  refreshIntervalMs,
  refusalKind,
  slotVerdict,
  waitExhausted,
  type LimitBasis,
  type LimitReading,
  type Reaction,
} from '@plot-pm/domain';
// THE ONE ADAPTER THIS FILE CONSTRUCTS FOR ITSELF, and the reason it is here
// rather than behind `BuildBoardOptions`: the cap is shared state on the
// COMPUTER, not a fixture a caller substitutes — a board handed an in-memory
// one would bound only itself, which is the failure the port's own comment
// names. `slotsFile` is seamed by `PLOT_BUDGET_HOME`, which is how a test moves
// it, exactly as `budgetFile` is.
import { slotsFile } from '@plot-pm/domain/adapters';
import { readBridge, writeBridge } from './pulse-bridge.js';
import { readFleetSettings } from './fleet-settings.js';
import { maybeAutoDispatch } from './auto-dispatch.js';
import { readMachine } from './machine-reading.js';
import { maybeAutoDeliver } from './auto-deliver.js';
import { readAgentRegistryWithInfo, bashCleanliness } from './registry.js';
import type { RegistryInfo } from './registry.js';
import type { AgentEntry } from './registry.js';
import { workerQuestions } from './worker-question.js';
import { briefPath as briefPathOf } from './brief-path.js';
import { findingsFor } from './findings.js';

/**
 * How long a branch may sit without a commit before it reads as quiet rather
 * than working. Thirty minutes is a guess — which is exactly why it is a config
 * key: a repo whose agents think for an hour raises it without a code change.
 * The row carries the age either way, so a misjudged window is visible rather
 * than misleading.
 */
const DEFAULT_QUIET_MINUTES = 30;

/**
 * The scan takes 0.5–1.05 s. The board is a single-threaded HTTP server, so
 * running it per request on a 4 s client poll would block the event loop
 * roughly a quarter of the time. Instead the server refreshes on its own timer
 * with the ASYNC execFile and every request reads the cache — client poll rate
 * and scan duration are thereby decoupled: twenty plans give you a *staler*
 * tab, not a *slower* board.
 */
const REFRESH_MS = 5_000;

/**
 * How often to ask the HOST for pull-request state — a different question from
 * the one above, on a different clock, for a reason that cost this repo a day.
 *
 * The git scan is local and free; the PR fetch is a metered GraphQL call. Firing
 * both on the 5 s timer meant 720 host calls an hour, which exhausts a
 * 5000/hour budget in under a working day — and did, on 2026-08-16, mid-plan
 * (`remaining 0/5000, used 5007`).
 *
 * 60 s is chosen against what the data actually does: a review landing or a
 * check turning green is a minutes-scale event, so five-second freshness buys
 * nothing here. The freshness that matters at 5 s is git's, and git stays at
 * 5 s.
 */
const PR_REFRESH_MS = 60_000;

/**
 * The longest the PR fetch backs off to when the host reports a rate limit and
 * gives no reset time to wait for. Doubling from 60 s stops here rather than
 * growing without bound — past two minutes the tab is stale enough that the
 * board should be retrying, not sulking.
 */
const PR_BACKOFF_MAX_MS = 120_000;

/**
 * How many host calls a board allows itself at once before any refusal.
 *
 * **NULL, BECAUSE NOTHING LICENSES A NUMBER YET.** The estate's one measurement
 * is 2026-08-27, where eight workers produced a 403 naming abuse detection;
 * seven is an inference from that eight and has no independent source — not
 * GitHub's documentation, not a second observation. So no cap is compiled in
 * here either: the bound is derived from the connector's own limit reading by
 * `boundFromLimit` on every refresh, and lowered by every secondary refusal.
 *
 * A board that has read no limit yet, from a connector that reports none, runs
 * unbounded — which is what it did before this slice. The first reading
 * proposes a bound and the first refusal corrects it, and neither is a constant
 * somebody guessed.
 */
const PR_CONCURRENCY_START = null;

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
 */
const PR_REQUESTS_PER_REFRESH: Record<string, number> = {
  // One `gh pr list --state all` call, whatever the states asked for; the
  // GitHub `issue-list` and `runs` calls ride the same GraphQL budget and the
  // board's own measurement treats the refresh as one unit there.
  github: 1,
  // Three for `pr-list --state all` (open, merged, declined — `bb` has no `all`
  // state) plus one for `issue-list`, which now reaches the network instead of
  // exiting 4. Do not "fix" the three by inventing an `all` — it would fabricate
  // an answer the host cannot give.
  bitbucket: 4,
};

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
const PR_LIMIT = 1000;

/**
 * How many open issues to ask for.
 *
 * Small where `PR_LIMIT` is large, because the two answer different questions.
 * `prs` is asked for HISTORY — a delivered plan's card still links its merged
 * PR — so it must reach back. Issues are asked for an INBOX, and an inbox is
 * only ever the top of the list: past this many unplanned issues the board is
 * not the thing that needs fixing. Capping it also bounds the response on a
 * repo whose tracker is used as a discussion forum.
 */
const ISSUE_LIMIT = 50;

/* ------------------------------------------------------------------------ */
/* Master agent branch — the main checkout's current branch                  */
/* ------------------------------------------------------------------------ */

/**
 * How long the master agent branch reading stands before re-asking git.
 *
 * The same 5 s TTL as `server-info.ts` (#410) and for the same reasons: a
 * branch switch shows up within seconds, and the read stays off the
 * per-request path (fleet renders every 4 s).
 *
 * The TTL was worth more when the read was two synchronous spawns. It is one
 * awaited port call now, so what it saves is a process launch rather than a
 * blocked event loop — kept because the saving is real and the staleness it
 * costs is bounded at five seconds, not because the board still depends on it.
 *
 * DISTINCT FROM `server-info.ts` DELIBERATELY. That file caches
 * `server.branch`, which is the branch the SERVER'S worktree is on. This is
 * the MAIN CHECKOUT's branch, which may differ. The brief pins that the two
 * must NOT share an implementation: `server.branch` is memoised once per
 * process (the server serves one worktree for its whole life), while this one
 * needs to follow a branch switch in a different tree. A shared helper would
 * either break the test that pins the server's read-once or silently freeze
 * this field on the branch the board started with.
 */
const MASTER_AGENT_BRANCH_TTL_MS = 5_000;

/**
 * Cached master agent branch and the time it was read.
 *
 * Module-level rather than in `CacheEntry`, for the same reason
 * `server-info.ts` puts its branch cache at module level: the cache is per
 * PROCESS, not per repo root. A process serves exactly one repo, and the
 * master agent branch is a fact about that repo's main checkout — it is the
 * same whether the request came through `/api/fleet` or `/api/board`.
 */
let masterAgentBranchCache: { branch: string; at: number } | null = null;

/**
 * The branch the MAIN CHECKOUT is on — the operator's branch, where a person
 * and the master agent do the concept work.
 *
 * NOT THE SERVER'S CHECKOUT. A board started in a linked worktree still reads
 * the main checkout; naming the board's own tree was considered and rejected
 * because that is `server.branch` again.
 *
 * ONE PORT CALL, WHERE THERE WERE TWO SPAWNS. `git worktree list` was run to
 * find the main checkout's path and `git branch --show-current` was then run
 * inside it, and both were synchronous — a stack sampled on a wedged board
 * caught `SyncProcessRunner::Spawn` under the request handler in 4258 of 4262
 * main-thread samples, and a synchronous spawn cannot yield, so a static file
 * timed out at 15 s beside it. `Trees.list()` reports every worktree WITH its
 * branch, so the second question was already answered by the first listing.
 *
 * Returns `''` for every failure: detached HEAD, not a git repo, no main
 * checkout in the listing. The schema's default is `''`, and the renderer
 * shows NO ROW rather than a placeholder.
 *
 * The empty value is not silent, though. A genuine detached HEAD returns `''`
 * quietly — the port answered, and `''` is what it answered — while a port that
 * could not answer at all is logged before it collapses to `''`. The two are
 * the same value but not the same event, and conflating them silently is what
 * let a bundling error read as a detached HEAD and hid a one-line bug through a
 * full investigation. That distinction cost a `try`/`catch` when the call
 * spawned; the port carries it in `ok`.
 */
async function readMasterAgentBranch(opts: BuildBoardOptions): Promise<string> {
  const now = Date.now();
  if (masterAgentBranchCache && now - masterAgentBranchCache.at < MASTER_AGENT_BRANCH_TTL_MS) {
    return masterAgentBranchCache.branch;
  }

  let branch = '';
  const trees = await treesFor(opts).list();
  if (!trees.ok) {
    // The port could not answer — not a repo, git absent, a listing it could
    // not parse. Distinct from "it answered and no tree is the main one", and
    // distinct again from a detached HEAD, which is an answer of `''`.
    console.warn(`[fleet] worktree listing unavailable in ${opts.repoRoot}: ${trees.why}`);
  } else {
    const main = trees.value.find((tree) => tree.isMain);
    if (main === undefined) {
      console.warn(`[fleet] no main checkout in the worktree listing for ${opts.repoRoot}`);
    } else {
      // The listing answered. An empty branch here is a genuine detached HEAD
      // — the renderer shows no row, which is correct for that case.
      branch = main.branch;
    }
  }

  masterAgentBranchCache = { branch, at: now };
  return branch;
}

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
}

/**
 * The prefix a branch name is appended to, for the ONE origin this board reads —
 * or "" where no honest link can be built.
 *
 * Two hosts, two different words for the same page (`/tree/` on GitHub,
 * `/branch/` on Bitbucket Cloud), chosen by the same gh/bb distinction the rest
 * of the board already makes. Everything else returns "": a self-hosted
 * Bitbucket puts branches under `/projects/KEY/repos/name/branches`, and nothing
 * in the origin URL says which shape a stranger's host uses.
 *
 * The host is kept verbatim, so a GitHub Enterprise install links to itself
 * rather than to github.com — the rule `CardPrSchema` states for PR links,
 * applied to the one URL the board does compose. A guess here would look exactly
 * as confident as a correct answer.
 */
export function branchUrlBase(origin: string): string {
  const trimmed = origin.trim();
  if (!trimmed) return '';
  // Both forms git leaves behind: `https://host/owner/repo.git` and the
  // scp-style `git@host:owner/repo.git` that `git clone git@…` produces.
  const m = /^(?:https?:\/\/(?:[^@/]*@)?([^/]+)\/|(?:ssh:\/\/)?(?:[^@/]+@)([^:/]+)[:/])(.+?)(?:\.git)?\/?$/
    .exec(trimmed);
  if (!m) return '';
  const host = (m[1] ?? m[2]).replace(/:\d+$/, '');
  const repoPath = m[3];
  if (!repoPath || repoPath.includes('..')) return '';
  // `github.com` and any Enterprise install, which conventionally names itself
  // github.<something>. Bitbucket Cloud is exactly one host — Server/Data Center
  // uses a different path shape, so `bitbucket.example.com` must NOT match.
  if (host === 'github.com' || /(^|\.)github\./.test(host)) {
    return `https://${host}/${repoPath}/tree/`;
  }
  if (host === 'bitbucket.org') {
    return `https://${host}/${repoPath}/branch/`;
  }
  return '';
}

// Exported for the type alone: `freshCacheEntry` already hands this object to
// callers, so naming its shape adds no surface — it lets a test spell the type
// it is already holding.
export interface CacheEntry {
  /**
   * Terminal branch answers, carried from one pulse to the next.
   *
   * Measured on this repo 2026-08-19: 26 of 54 branches are terminal — merged
   * or deferred — and a terminal fact cannot change. The scan pays one host
   * round trip per such branch on the no-ref arm, and paid it again every 5 s
   * forever.
   *
   * THE BOARD HOLDS IT BECAUSE THE BOARD IS THE ONLY LONG-LIVED PROCESS. The
   * scan is spawned fresh per pulse, so it cannot span two; it takes this map
   * in through the environment and reports the map the NEXT pulse should hold
   * on stderr. What arrives back is the whole map, not a delta, so there is no
   * merge rule here to get wrong.
   *
   * IN MEMORY AND NOWHERE ELSE. Never written to disk, never to `.plot/` — a
   * restart re-derives everything. A cache that survived a restart would be a
   * second source of truth about a repo whose only source of truth is git
   * (Manifesto Principle 1), and it is the SCAN, not this field, that decides
   * an entry is still valid: git is re-consulted on every pass and the entry
   * is discarded the moment it disagrees.
   */
  terminal: string;
  pulse: FleetReading | null;
  ages: Map<string, number | null>;
  at: number | null;
  error: string | null;
  /**
   * What the last successful scan lost relative to the one before it, or null.
   *
   * Sits beside `error`, never inside it: `error` is a scan that failed and was
   * discarded, this is a scan that succeeded and was KEPT. See `pulseShrink`.
   */
  shrink: PulseShrink | null;
  /**
   * The branch-URL prefix for this repo's origin, read ONCE per scan rather than
   * per row: `git remote get-url origin` is a process spawn, and a fleet of
   * fifteen branches would otherwise pay fifteen of them every five seconds. ""
   * where the origin is unrecognised, which renders as plain text.
   */
  branchUrlBase: string;
  /**
   * Approval date per plan basename, epoch ms. Read on the scan's timer beside
   * the branch ages — one parser run over the pulse's plans, never one per row.
   * A plan with no `Approved:` record is absent rather than zero.
   */
  approvedAt: Map<string, number>;
  /** Plan filename per idea branch — see `ideaPlanFiles`. */
  ideaPlans: Map<string, string>;
  /** The version each release branch would ship — see `releaseVersions`. */
  versions: Map<string, string>;
  /**
   * Every remote branch with commits the default branch lacks — see
   * {@link unmergedBranches}.
   *
   * DELIBERATELY NOT IN THE BRIDGE, unlike the ages and approval dates beside
   * it. Those are facts that stay true while the process is gone; this one is a
   * statement about what has landed, and a `node --watch` restart is frequently
   * FOR a merge. A bridged set would list branches that merged while the process
   * was down, each rendered as outstanding work in a freshly-timestamped row.
   * Absent instead, which adds no rows until the first scan lands — a board that
   * is briefly incomplete rather than one that is confidently wrong.
   */
  unmerged: Set<string>;
  /**
   * What each `waiting` worker asked, by branch — see `workerQuestions`.
   *
   * ON THE SCAN'S CLOCK, like the ages and the approval dates beside it, and for
   * the same reason: it is a question about THIS machine's filesystem, and the
   * render path must not be the thing that asks it.
   *
   * DELIBERATELY NOT IN THE BRIDGE. Every other field there is a fact that stays
   * true while the process is gone — a commit's age, a plan's approval date — so
   * restoring it labelled with its real age is honest. A question is the
   * opposite: it exists precisely until somebody answers it, and the answering
   * is what a `node --watch` restart is often FOR. A bridged question would name
   * something already resolved, with a fresh-looking row around it. Absent
   * instead, which renders as *reason unavailable* until the first scan lands —
   * an unknown the reader can act on rather than a stale claim they cannot.
   */
  questions: Map<string, string>;
  /**
   * PR data is cached BESIDE the pulse, with its own timestamp and error — the
   * two sources fail independently. The host can be down while git is fine, and
   * a fetch can fail behind a VPN while `gh` works; sharing one staleness would
   * freeze data that was available the whole time.
   */
  /**
   * Open issues no plan references, and whether the tracker could be asked.
   *
   * Three fields for the same reason the contract has three: `issues` alone
   * cannot distinguish an empty inbox from a host that was never asked. Kept
   * across a failure like `prs`, so a fetch error does not retract rows.
   */
  issues: IssueRow[];
  issueAnswer: IssueAnswer;
  issueError: string | null;
  /**
   * The dispatcher's agent registry, re-read on every scan tick.
   *
   * Not kept across a failure the way `prs` and `issues` are, and the difference
   * is the source: those ask a host that can refuse, so retracting rows on an
   * outage would be a lie. This reads a local directory, where absence means no
   * dispatch has run — a fact, not a failure.
   */
  agents: AgentEntry[];
  /**
   * Metadata about the registry read — directory, manifest count, synthesized
   * count. Makes a synthesized fleet legible: `0 manifests, 12 synthesized`
   * says the fleet is not empty, just identity-less.
   */
  registry: RegistryInfo | undefined;
  /**
   * Branches AUTO-DISPATCH has started this session whose claim/manifest the
   * next pulse cannot yet see.
   *
   * `plot-dispatch.sh` is spawned detached, so a branch dispatched on one pulse
   * may show neither a claim ref nor a manifest on the very next one. Counting
   * only the registry against the cap would then dispatch it a second time and
   * let the fleet reach 2N. This set holds such branches against the cap until a
   * pulse confirms them (claimed, merged, gone, or held by a live registry
   * entry), at which point `pruneInFlight` retires them.
   *
   * IN MEMORY AND NOWHERE ELSE, like `terminal` above: it describes what THIS
   * process did, a restart re-derives from git, and it must never become a
   * second source of truth about a repo whose only one is git.
   */
  autoInFlight: Set<string>;
  /**
   * The slugs a DELIVERY has been started for and whose effect no pulse has
   * confirmed yet — the same cross-pulse guard `autoInFlight` is, for the same
   * reason and with the same lifetime.
   *
   * `plot-deliver.sh` pushes to the default branch, and the scan fires every few
   * seconds; without this a plan would be delivered a dozen times over while the
   * first run was still working. Idempotence makes that harmless, not free.
   *
   * IN MEMORY AND NOWHERE ELSE. A restart re-derives it: a plan whose delivery
   * landed no longer reads `approved`, and one whose delivery did not is simply
   * offered again.
   */
  deliverInFlight: Set<string>;
  prs: Map<string, PrRecord> | null;
  /**
   * The same records keyed by PR NUMBER. The fleet tab asks "what is this
   * branch waiting for" and looks up by head; the board asks "where does PR
   * #113 live" and has only the number a plan wrote down. One fetch, two
   * indexes — rather than a second `pr-list` call on the board path.
   */
  prsByNumber: Map<number, PrRecord> | null;
  /**
   * EVERY PR keyed by head branch — merged and closed ones included, which is
   * the one thing `prs` deliberately withholds.
   *
   * A third index off the same fetch, for the same reason the second exists:
   * two questions, one call. `prs` answers *what is this branch waiting for*,
   * and it must stay OPEN-only — a merged PR reaching `classify` would answer
   * for a branch whose git state has already answered, reopening a question the
   * merge closed. That filter is correct and stays.
   *
   * But it also decides the row's LINK, and there the filter is wrong: a merged
   * PR is precisely the one a reader still wants to open. Measured 2026-08-20 on
   * this repo — #252, #253 and #254 are `MERGED` with real heads and real URLs,
   * their refs deleted, and every one of them reached the row as `pr: null`.
   * The PR outlives the branch, so the link must too.
   *
   * So the two uses are split rather than the filter loosened: `classify` keeps
   * the open-only map, and the link is looked up here. Keyed by head like `prs`
   * — a row has a branch name and nothing else to ask with.
   */
  prsByHead: Map<string, PrRecord> | null;
  /**
   * Recent CI runs per branch, for the FAILING branches only — see
   * `refreshRuns`. Filled on the PR timer beside the PR map, because it is the
   * same metered clock and the same source; a branch absent from it simply has
   * no history to show.
   */
  runs: Map<string, StuckRun[]>;
  prAt: number | null;
  prError: string | null;
  /**
   * What the budget record said this account was spending at the last refresh,
   * in requests an hour, or null where it could not be read.
   *
   * ALREADY READ, NOT ASKED AGAIN. `spendRateFor` runs once per refresh to
   * divide the cadence, and this holds that same number so the banner can say
   * how many spenders the record accounts for. A second read would be a second
   * `bash` per refresh and, worse, a different number: the two would disagree
   * whenever a line landed between them.
   *
   * NULL IS AN ABSENT MEASUREMENT, never an idle account — the same direction
   * `spendRateFor` fails in. The banner then names the limit and invents no
   * population.
   */
  prSpendPerHour: number | null;
  /**
   * When the record says this account's bucket refills, epoch ms, or null.
   *
   * READ FROM THE RECORD BESIDE THE RATE, on the same `spend-rate` call, so a
   * refusal has a reset to wait for without a second question. The value is
   * `X-RateLimit-Reset` as the headers carried it — the authority the plan
   * settles on, against `gh api rate_limit`, which reported 5000 while a live
   * call's headers read 0.
   *
   * NULL IS AN UNSTATED RESET, never an immediate one. A caller reading it gets
   * `stated: false` from `reactionTo` and waits that rule's ceiling, so a
   * banner can decline to print a reset it never received.
   */
  prResetAt: number | null;
  /**
   * The bound refusals have lowered this board to, or null where none has
   * refused.
   *
   * LOWERED BY A SECONDARY REFUSAL AND BY NOTHING ELSE. It starts null — no
   * refusal, no evidence — and halves on every burst refusal, floored at one,
   * which is the correction `loweredConcurrency` performs.
   *
   * IT NEVER RISES WITHIN A SESSION. The absence of a refusal is not evidence
   * that more would have been allowed, so restoring the bound is a different
   * question with a different input.
   *
   * **IT IS THE FLOOR, NOT THE CAP.** The cap this board actually runs at is
   * `concurrencyBound(boundFromLimit(reading), this)` — the connector's own
   * proposal and this correction, whichever is lower — recomputed on every
   * refresh, because the connector's reading moves and this does not.
   */
  prConcurrency: number | null;
  /**
   * What the record last said the connector's ceiling is, and how it knows.
   *
   * READ FROM THE SAME `spend-rate` CALL the cadence divides by, so the bound
   * costs no extra host request and no extra `bash`. The record stores the
   * limit the response headers carried; a connector that reports none leaves
   * the basis `unknown`, which proposes no bound at all.
   */
  /**
   * How many of the account's slots were claimed at the last refresh, or null
   * where the claims could not be read.
   *
   * READ ONCE PER REFRESH, beside the rate, so the number a reader sees is the
   * one the gate acted on. Reading it again in the payload would be a second
   * `readdir` answering a different moment.
   */
  prSlotsHeld: number | null;
  prLimit: number | null;
  /** How the limit reading was come by — `actual`, `predicted`, or `unknown`. */
  prLimitBasis: LimitBasis;
  /**
   * The account the cap belongs to, as `plot-host.sh` resolves it.
   *
   * PER ACCOUNT, NOT PER PROCESS — the plan's whole name. Two boards are two
   * budgets against one cap, and the slot directory is keyed by this rather
   * than by a checkout or a pid.
   */
  prAccount: string | null;
  /**
   * Epoch ms before which the PR fetch must not fire again. Normally the
   * fetch's START plus `PR_REFRESH_MS`; pushed further out when the host
   * reports a rate limit, to the reset it named if it named one. A gate rather
   * than a second timer: one clock decides, and a backoff cannot leave a timer
   * orphaned.
   *
   * Measured from the start and not the finish deliberately. Stamping it from
   * the finish put it at `PR_REFRESH_MS` + the call's duration — just past the
   * rigid interval tick meant to satisfy it, so that tick was refused and the
   * next came a full period later. A 1.4 s call therefore bought a 120 s
   * cadence from a 60 s setting, which is the 111 s age this repo measured on
   * 2026-08-18.
   */
  prNextAt: number;
  /**
   * Whether `prNextAt` is a floor the HOST named rather than the ordinary
   * cadence target. True only after a rate-limit backoff.
   *
   * The two are compared with different strictness — see `prGateOpen`. A
   * cadence target tolerates a tick arriving fractionally early, because that
   * tick is the one the period is entitled to; a host's backoff tolerates
   * nothing, because calling before it is what exhausted the quota.
   */
  prNextIsBackoff: boolean;
  /**
   * The interval this board is currently leaving between PR refreshes, in ms.
   *
   * THE BOARD'S OWN CONTRIBUTION, WHICH IS WHAT IT SUBTRACTS FROM THE OBSERVED
   * RATE. The budget record counts every spender on the computer, this board
   * included, so a stretch taken straight from it would chase the board's own
   * tail. Knowing what this board is spending right now is what turns the same
   * reading into a division that settles on one board's share.
   *
   * Derived, never counted. It is exactly what the last `prRefreshMsFor`
   * returned, so the record needs no process identity to attribute a line.
   *
   * Starts at the unstretched interval, which is where a board starts, and is
   * re-derived on every refresh rather than accumulated — a value carried
   * forward through a failure would drift with nothing to correct it.
   */
  prIntervalMs: number;
  /**
   * The configured git host — `github` or `bitbucket` — or null before the
   * first lookup. Decides what one PR refresh COSTS, and therefore how far
   * apart the refreshes go; see `prRefreshMsFor`.
   *
   * Cached because it is configuration rather than state: it is read from
   * `PLOT_HOST` or the `Git host` key, so it cannot change under a running
   * process without a human editing a file the process would be restarted for.
   * Asking once also keeps the cost model honest — a cadence that spent a call
   * to decide how many calls to spend would be measuring itself.
   */
  backend: string | null;
  /**
   * Whether the pulse in `pulse` is every plan the scan found, or only the ones
   * that had resolved when it was last read.
   *
   * The streaming scan's half of the rule the rest of this file already obeys:
   * `claimed: 0` and "no pulse yet" must not render identically, and neither
   * must "no plans left" and "the rest have not arrived". A scan takes 18 s on
   * 84 branches, so for most of that window the answer is genuinely partial —
   * which is a fact about the answer, not a defect in it.
   *
   * True the moment the scan's terminal line lands, and only then. A closed
   * pipe does not set it: a killed scan closes the pipe too, and treating that
   * as completion is how a partial answer starts reading as a whole one.
   *
   * Starts true so a cold cache and a bridged pulse behave exactly as before —
   * `pulse: null` already says "nothing has arrived", and a second field
   * saying it differently is the sort of duplicate this file removes.
   */
  pulseComplete: boolean;
  /**
   * This machine's clock, or null before `ensureCache` started it.
   *
   * Replaces the `timer`/`prTimer` pair. Both cadences are subscribers on it
   * now — divisors 1 and 12 — so the two numbers that were `5_000` and `60_000`
   * in two constants are one base and one ratio.
   */
  pulseClock: RunningPulse | null;
  running: boolean;
  prRunning: boolean;
}

const caches = new Map<string, CacheEntry>();

function cacheKey(opts: BuildBoardOptions): string {
  return `${opts.repoRoot}\0${opts.scriptsDir}`;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 << 20 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/**
 * The two facts about the REPO STATE that a timeout can honestly report, both
 * measured — what a bare `timed out after 90000ms` withholds, and nothing more.
 *
 * `worktrees` and `branches` are counts, not estimates: cheap to take, and real
 * counts of real things. They say the estate is large. They do NOT say the
 * estate is why the scan was slow, because that was measured and is false — see
 * below.
 *
 * There is no `spawnCount`. The board cannot count the spawns of a scan it just
 * SIGKILLed, so it names the branch count it CAN measure rather than printing a
 * fabricated `spawns ≈ 8 × branches` dressed as a measurement.
 *
 * There is no `perSpawnMs` either, and its removal is the same rule applied one
 * value over — the rule this file stated and then broke four lines later. It
 * timed `git rev-parse --git-dir`, which prints a path: it reads neither the ref
 * database nor the worktree list, so it was never timing the estate's effect on
 * launch cost. It timed how loaded this machine was. Acting on the report proved
 * it: 26 of 37 worktrees pruned, the count fell 70 %, the wall-clock did not
 * move (97 s), and the figure promised to fall rose 33 % (80 → 106 ms). The same
 * run clocked `git --version` — which opens no repository at all — at 2,037 ms.
 *
 * It is deleted rather than repaired because no honest version is reachable from
 * here: attributing spawn cost to an estate needs a SECOND estate to compare
 * against, and the board has only the one it runs in. The measured share of the
 * scan spent inside git was 25 s of 131 s, so where the other 81 % went is a new
 * measurement, not a correction — recorded as this plan's follow-up.
 */
export interface EstateMeasurement {
  worktrees: number;
  branches: number;
}

/**
 * The scan's timeout message, only if it IS a timeout. `runStreaming` rejects a
 * budget overrun with exactly `timed out after <n>ms`; every other rejection —
 * a non-zero exit, a spawn failure, a missing terminal line — is a different
 * fault the estate does not explain, so this matches the one shape it fits.
 */
function isTimeout(message: string): boolean {
  return /^timed out after \d+ms$/.test(message);
}

/**
 * Append the measured estate to a scan error, but ONLY when the error is a
 * timeout and the measurement succeeded.
 *
 * Every other case returns the message untouched, which is the spec's "a scan
 * under budget says nothing extra" read at full width: a scan that failed for
 * any reason but the budget, or one whose estate could not be measured (a repo
 * mid-rebase, a vanished worktree), gets the bare message rather than a
 * half-filled one. An absent number is reported as absent, never as zero.
 */
export function withEstate(message: string, m: EstateMeasurement | null): string {
  if (m === null || !isTimeout(message)) return message;
  return `${message} — ${estateReport(m)}`;
}

/**
 * The measured estate as one clause: the two counts, and no mechanism.
 *
 * Pure, and now trivially so — the numbers it prints are exactly the numbers it
 * was handed, it multiplies nothing, and it rounds nothing. It also EXPLAINS
 * nothing, which is the point. It used to close with "pruning stale worktrees
 * cuts both the count and the per-spawn cost", a cause and a remedy neither
 * count supports; a reader who trusted it pruned 26 worktrees and got a slower
 * scan reporting a higher number. A wrong explanation costs more than no
 * explanation, because it is actionable.
 *
 * So the reader learns the estate is large and the scan did not finish. That is
 * true, it is all this function measured, and it is what a timeout report owes.
 */
export function estateReport(m: EstateMeasurement): string {
  const wt = `${m.worktrees} worktree${m.worktrees === 1 ? '' : 's'}`;
  const br = `${m.branches} branch${m.branches === 1 ? '' : 'es'}`;
  return `${wt}, ${br}`;
}

/**
 * Count the estate a slow scan runs in, or null if the counting itself fails.
 *
 * Only ever called ON the timeout path, so its cost — one worktree list, one ref
 * enumeration — is paid once per failed scan, not per pulse. It used to also fire
 * five bare `git` spawns to time launch overhead; those are gone with the number
 * they fed, so the timeout path costs five spawns fewer as well as saying less.
 *
 * Returns null rather than a partial object if either read throws: a sentence
 * missing a number would be worse than the bare timeout it replaces, and the
 * `an-outage-is-not-an-answer` rule says a value that could not be observed is
 * reported as absent, not as zero.
 */
async function measureEstate(opts: BuildBoardOptions): Promise<EstateMeasurement | null> {
  try {
    const wtOut = await run('git', ['worktree', 'list', '--porcelain'], opts.repoRoot);
    const worktrees = wtOut.split('\n').filter((l) => l.startsWith('worktree ')).length;

    const brOut = await run('git',
      ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'], opts.repoRoot);
    const branches = brOut.split('\n').filter((l) => l.trim() !== '').length;

    return { worktrees, branches };
  } catch {
    return null;
  }
}

/**
 * Run a command and hand each complete stdout LINE to `onLine` as it arrives.
 *
 * The whole point of this file's streaming scan, and the reason it is not
 * `run()` with a split: `execFile` resolves when the process EXITS, so a
 * consumer reading its result waits the full 18 s no matter how early the first
 * plan resolved. Here the caller sees line one when line one is written.
 *
 * Rejects exactly as `run` does — a non-zero exit, a timeout, a spawn failure.
 * Lines already delivered are NOT retracted: `onLine` has been called and the
 * caller has kept what arrived, which is the behaviour a partial scan needs.
 * A rejection therefore means "no more is coming", never "discard the rest".
 *
 * stdout only. The scan writes its notes to stderr and its document to stdout,
 * and mixing them would put prose through `JSON.parse`.
 */
/** The scan Plot ships, streamed one plan at a time. */
const FLEET_SCAN = 'plot-fleet-scan.sh';

/**
 * The scan's budget, SET FROM MEASUREMENT — and the measurement moved.
 *
 * 30 s was right when the scan was ~10 s. After #262 batched the per-plan reads
 * it is 34-52 s on this repo — 84 s before that change — and the spread is the
 * machine rather than the code: measured 2026-08-20 with 12 worktrees and a load
 * average of 8.35, a BARE `git` spawn cost 63 ms against 31 ms on a quiet
 * machine, and the same `rev-list` timed 14 ms, 85 ms and 111 ms on three
 * consecutive runs. 203 spawns at 63 ms is ~13 s of process launch before any
 * work.
 *
 * So a fixed budget below the loaded cost fails INTERMITTENTLY, which is the
 * worst shape: 60 correct rows arrived and the pulse was killed before its
 * terminal line, so `pulseComplete` stayed false, the banner never cleared, and
 * the footer read `60 branches across 20 plans SO FAR` — accurate, and
 * indistinguishable from a broken board.
 *
 * 90 s is HEADROOM over a 34-52 s cost, not cover for a 279 s one. It was
 * refused twice while the scan was 279 s, because a budget raised to fit a 9x
 * overrun hides the next regression instead of reporting it. The remaining
 * per-branch `rev-list` block (64 calls) is the next thing to batch, and when it
 * lands this can come back down.
 */
const FLEET_SCAN_BUDGET_MS = 90_000;

export function runStreaming(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
  timeoutMs = 30_000,
  opts: {
    /** Extra environment for the child, merged over the parent's. */
    env?: NodeJS.ProcessEnv;
    /**
     * Called with each complete STDERR line, if given.
     *
     * stderr stays drained either way — see below. This hook exists for the
     * terminal cache, which the scan reports out of band precisely so stdout
     * stays byte-identical to a run without it.
     */
    onErrLine?: (line: string) => void;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    });
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      // SIGKILL rather than SIGTERM: the scan is a bash script that spawns git,
      // and a TERM it traps or a child that ignores it would leave this promise
      // pending past the timeout it exists to enforce.
      child.kill('SIGKILL');
      if (!settled) { settled = true; reject(new Error(`timed out after ${timeoutMs}ms`)); }
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      // A chunk boundary falls wherever the OS put it, so the LAST fragment is
      // kept for the next chunk rather than parsed. Splitting on '\n' and
      // handing every piece onward would deliver half a JSON object as a line.
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) onLine(line);
      }
    });
    // DRAINED EITHER WAY. Left unread, a chatty scan fills the pipe buffer and
    // blocks writing to stdout — the stream stalls for a reason that looks
    // nothing like its cause. With a handler the draining is done by reading
    // the lines rather than by discarding them; without one, discarded exactly
    // as before.
    if (opts.onErrLine) {
      let ebuf = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        ebuf += chunk;
        let nl: number;
        while ((nl = ebuf.indexOf('\n')) !== -1) {
          const line = ebuf.slice(0, nl);
          ebuf = ebuf.slice(nl + 1);
          if (line.trim()) opts.onErrLine!(line);
        }
        // A scan that writes an unbounded stderr line must not grow this
        // forever. The notes are one short line per branch; anything past that
        // is not a note and is dropped rather than buffered.
        if (ebuf.length > 1 << 16) ebuf = '';
      });
    } else {
      child.stderr?.resume();
    }
    child.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // The trailing fragment, if the scan wrote no final newline.
      if (buf.trim()) onLine(buf);
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

/**
 * One plan merged into a pulse being assembled, replacing any earlier entry for
 * the same file.
 *
 * Keyed by `file` because that is the key every consumer already joins on —
 * `summariseFromPulse` and `worktreesFromPulse` both find a plan by basename.
 * Replacement rather than append keeps a re-scan of the same plan idempotent,
 * so a scan that emits a plan twice cannot double a card's slice count.
 */
export function mergePlan(plans: FleetReading['plans'], plan: FleetReading['plans'][number]): FleetReading['plans'] {
  const at = plans.findIndex((p) => p.file === plan.file);
  if (at === -1) return [...plans, plan];
  const next = plans.slice();
  next[at] = plan;
  return next;
}

/**
 * The summary a PARTIAL pulse can honestly state — counted from the plans that
 * have arrived, never carried over from the last complete scan.
 *
 * Recounted rather than reused for the reason the whole branch exists: a
 * summary describing 24 plans beside a `plans` array holding 3 is a measurement
 * of one thing presented as a measurement of another. The numbers here are
 * small and true; the previous scan's numbers were large and about a different
 * document.
 *
 * `blocked`, `deferred`, `waiting` and `prereq_missing` are counted the same way
 * the scan counts them, which is the one duplication this function accepts — see the note on `summarizeStuck`
 * for why counting FROM the rows beats tallying beside them: a partial pulse has
 * no other source, and deriving it here means it cannot disagree with the plans
 * it is derived from.
 */
export function partialSummary(plans: FleetReading['plans']): FleetReading['summary'] {
  let waves = 0, branches = 0, claimed = 0, eligible = 0, blocked = 0, deferred = 0;
  // BRANCH counters, beside the SLICE `blocked` above. A branch held by its
  // `waits:` annotation is in exactly one of these and in neither of the slice
  // tallies.
  let waiting = 0, prereqMissing = 0;
  for (const plan of plans) {
    for (const wave of plan.slices) {
      waves += 1;
      if (wave.verdict === 'blocked') blocked += 1;
      for (const b of wave.branches) {
        branches += 1;
        if (b.state === 'deferred') deferred += 1;
        else if (b.state === 'claimed') claimed += 1;
        else if (b.state === 'waiting') waiting += 1;
        else if (b.state === 'blocked') prereqMissing += 1;
        else if (b.state === 'open' && wave.verdict === 'eligible') eligible += 1;
      }
    }
  }
  // `host` is deliberately `unknown` here and not `ok`. This summary is built
  // from the plan lines that have ARRIVED, mid-stream, before the scan has
  // reported whether the host answered — and a partial pulse asserting `ok`
  // would be claiming evidence it does not have. `unknown` renders no notice,
  // which is what a reader who cannot yet be told anything should see.
  return {
    plans: plans.length, waves, branches, claimed, eligible, blocked, deferred,
    waiting, prereq_missing: prereqMissing,
    host: 'unknown' as const,
  };
}


/**
 * What an incoming pulse LOST relative to the cached one, or null if it lost
 * nothing.
 *
 * The success-path counterpart to the rule `refresh` already applies to
 * failure. A pulse that describes fewer plans or fewer branches than its
 * predecessor is not necessarily wrong — plans get delivered, branches get
 * merged — but it is the one shape that produces the reported flicker, so it
 * may not pass in silence.
 *
 * SET DIFFERENCE, NOT COUNTS, in both directions of the pair. Counts are
 * cheaper and were the alternative in the plan's Open Points; they are also
 * blind to the case where one plan arrives as another leaves, which nets to
 * zero while a row really did vanish. The names are what make the eventual
 * message worth reading, and computing them costs one pass over a handful of
 * strings on a 5 s timer.
 *
 * GROWTH IS NOT SHRINKAGE and produces null: a pulse that gained a plan and
 * lost nothing is simply a better answer. Only the losing side of the
 * difference is looked at.
 *
 * Pure, exported, and given both pulses rather than reading the cache, because
 * this is the whole judgment — everything around it is plumbing, and a judgment
 * that can only be exercised through an async refresh and a subprocess is a
 * judgment that does not get tested.
 */
/**
 * What the fleet stopped seeing, in the shape the payload carries.
 *
 * THE SHRINK IS A DOMAIN RULE, and the name argues against itself. It drops
 * nothing: `readingLoss` compares two consecutive readings and reports what the
 * second no longer holds. That is a statement about the ESTATE — *the scan used
 * to see these and does not now* — which is a question about a Plan and a
 * Branch, not about a payload's size.
 *
 * What stays here is the SHAPE, and `shrinkNote` in the view keeps the
 * sentence. Three layers, and each says less than the one below it: the rule
 * decides what was lost, this names the field the payload carries it in, and
 * the note composes what a reader sees.
 */
export function pulseShrink(
  previous: FleetReading | null,
  incoming: FleetReading,
  previousAt: number | null,
): PulseShrink | null {
  return readingLoss(previous, incoming, previousAt);
}


/**
 * Minutes since each branch's tip commit. Read from local refs in one batch —
 * `for-each-ref` costs one process for every branch rather than one each, and
 * the scan has already fetched, so the refs are as fresh as the pulse is.
 */
async function branchAges(opts: BuildBoardOptions): Promise<Map<string, number | null>> {
  const ages = new Map<string, number | null>();
  try {
    const out = await run('git',
      ['for-each-ref', '--format=%(refname:short)\t%(committerdate:unix)', 'refs/remotes/origin'],
      opts.repoRoot);
    const now = Date.now() / 1000;
    for (const line of out.split('\n')) {
      const [ref, ts] = line.split('\t');
      if (!ref || !ts) continue;
      const short = ref.replace(/^origin\//, '');
      ages.set(short, Math.max(0, Math.round((now - Number(ts)) / 60)));
    }
  } catch {
    /* no refs readable — every age stays null, and the UI says so */
  }
  return ages;
}

/**
 * Every remote branch carrying commits the default branch does not have.
 *
 * `git branch -r --no-merged origin/<main>` is the whole definition, and
 * `--no-merged` is the BOUND rather than an optimisation. A merged branch has
 * nothing outstanding — that is already the rule everywhere else on this board,
 * and it is what keeps this addition from growing with history instead of with
 * abandoned work. Walking every branch would satisfy every other assertion the
 * plan makes while adding a row for each one that already landed.
 *
 * Read on the SCAN's clock beside {@link branchAges}, for the reason every
 * git-derived fact here is: `rowsFromPulse` is the synchronous render path and
 * cannot spawn a process, so anything from a ref arrives as a map the caller
 * built.
 *
 * One `for-each-ref`-shaped process per scan, not one per branch — the same
 * cost `branchAges` pays, on the same timer.
 *
 * EMPTY ON FAILURE, and empty means *not looked at* rather than *nothing
 * unmerged*. The only thing that reads this set adds rows from it, so a failed
 * read renders the board exactly as it did before the field existed rather than
 * claiming a fleet with no outstanding work.
 */
async function unmergedBranches(opts: BuildBoardOptions, main: string): Promise<Set<string>> {
  const found = new Set<string>();
  try {
    const out = await run('git',
      ['branch', '-r', '--no-merged', `origin/${main}`, '--format=%(refname:short)'],
      opts.repoRoot);
    for (const line of out.split('\n')) {
      const ref = line.trim();
      if (!ref) continue;
      // `origin/HEAD` is a SYMBOLIC ref, not a branch, and it resolves to the
      // default branch — which `--no-merged` cannot exclude because a symref is
      // not merged into itself. Left in, it renders a row named `HEAD` that no
      // reader can act on.
      if (!ref.startsWith('origin/') || ref === 'origin/HEAD') continue;
      const short = ref.slice('origin/'.length);
      if (!short || short === main) continue;
      found.add(short);
    }
  } catch {
    /* no refs readable — the set stays empty, and no row is added from it */
  }
  return found;
}

/**
 * When each plan was approved, in epoch ms, keyed by plan file BASENAME — the
 * key the pulse names plans by.
 *
 * Read through `plot-plan-meta.sh`, the one parser of plan files, exactly as
 * `board.ts` already reads it: the board holds no rule for what a plan file
 * looks like. Only the DATE portion of `Approved:` is used (`2026-08-16, jwloka,
 * in-session`); the rest is provenance for a human.
 *
 * A plan with no `Approved:` record — every plan predating the field — is simply
 * absent from the map. That is not a gap to fill with a guess: "approved at an
 * unknown time" and "approved just now" are different statements, and the row
 * shows nothing rather than the wrong one.
 */
/**
 * The plan file each idea branch carries, keyed by branch name.
 *
 * An idea branch introduces a plan that lives ON that branch, so the pulse —
 * which reads the default branch — never sees the filename. Without it the row
 * has a plan NAME and no way to open it, which is how two grouped rows ended up
 * with headings that were plain text beside a linked one.
 *
 * Read from git, one `ls-tree` per idea branch: they are few (two here), the
 * refs are local, and this runs on the pulse's own timer rather than per
 * request. Resolving by slug rather than by "the one file not on main" keeps it
 * a lookup instead of a diff.
 */
async function ideaPlanFiles(opts: BuildBoardOptions): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const planDir = await planDirectory(opts);
  const refs = await run('git',
    ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/idea/*'],
    opts.repoRoot);
  const branches = refs.split('\n')
    .map((l) => l.trim().replace(/^origin\//, ''))
    .filter(Boolean);
  for (const branch of branches) {
    const slug = /^idea\/(.+)$/.exec(branch)?.[1];
    if (!slug) continue;
    const out = await run('git',
      ['ls-tree', '-r', '--name-only', `origin/${branch}`, '--', planDir], opts.repoRoot);
    const hit = out.split('\n')
      .map((l) => l.trim())
      .find((l) => l.endsWith(`${slug}.md`));
    if (hit) found.set(branch, path.basename(hit));
  }
  return found;
}

/**
 * The version a release branch would ship, read from its own `package.json`.
 *
 * **Read, never derived** — see `AgentRow.version` for why that distinction is
 * the licence for this at all. Changesets consumes the `.changeset/*.md` files
 * and writes the bumped version into `package.json` **on the release branch**,
 * so the sum this board refuses to compute has already been computed by the
 * tool whose job it is. Verified 2026-08-20:
 * `origin/changeset-release/main:package.json` reads `2.7.0` where `main` reads
 * `2.6.0`.
 *
 * ONE `git show` for the whole pulse, not one per row: release branches are rare
 * (this estate has exactly one) and the map is built from the refs already in
 * hand. The scan's cost discipline is the reason — `for-each-ref` earned its
 * comment for the same trade.
 *
 * "" on anything unreadable — a ref that has gone, a repo whose root package
 * carries no version, malformed JSON. The row then names its PR number, which is
 * the honest fallback rather than an invented tag: the same rule the board
 * applies to a missing URL.
 */
async function releaseVersions(opts: BuildBoardOptions): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  // THE REFS, not the plans — and the first version of this read the plans,
  // which is why it found nothing on the live board while the mock looked right.
  //
  // `changeset-release/main` belongs to NO plan; that is precisely why it reaches
  // the board through the planless-PR loop. Feeding this function
  // `plans.flatMap(...waves...branches)` therefore passed a list that could never
  // contain the one branch it exists to read, and the filter matched nothing.
  //
  // The mock HID it: `version` was set there by hand, so the fixture built to
  // expose this shape was the reason it went unseen. Measured on the live board —
  // `version: ""` on the only release row.
  const refs = await run('git',
    ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/changeset-release/*'],
    opts.repoRoot).catch(() => '');
  const branches = refs.split('\n')
    .map((l) => l.trim().replace(/^origin\//, ''))
    .filter(Boolean);
  for (const branch of branches) {
    // `?? ''` because `run` rejects on a missing ref, and a release branch that
    // vanished between the ref listing and this read is a race rather than a
    // defect — it reads as *no version*, which is what the row then says.
    const raw = await run('git', ['show', `origin/${branch}:package.json`], opts.repoRoot)
      .catch(() => '');
    if (!raw) continue;
    try {
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof version === 'string' && version) found.set(branch, version);
    } catch {
      // Malformed JSON on a release branch is not this board's problem to
      // report, and a partially-parsed version would be worse than none.
    }
  }
  return found;
}

async function approvalDates(
  opts: BuildBoardOptions,
  pulse: FleetReading,
): Promise<Map<string, number>> {
  const dates = new Map<string, number>();
  if (pulse.plans.length === 0) return dates;
  const planDir = await planDirectory(opts);
  const files = pulse.plans.map((p) => path.join(opts.repoRoot, planDir, p.file));
  try {
    const answer = await scriptsFor(opts).planMeta(files);
    if (!answer.ok) return dates;
    for (const line of answer.value.split('\n')) {
      if (!line.trim()) continue;
      const meta = JSON.parse(line) as { file?: string; approved_raw?: string };
      if (!meta.file || !meta.approved_raw) continue;
      // The leading `YYYY-MM-DD` only. A record whose date does not parse is
      // dropped rather than coerced — Date's leniency would happily turn a typo
      // into a confident wrong age.
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(meta.approved_raw.trim());
      if (!m) continue;
      const at = Date.parse(`${m[1]}T00:00:00Z`);
      if (Number.isNaN(at)) continue;
      dates.set(path.basename(meta.file), at);
    }
  } catch {
    /* no parser, no plans dir, unreadable file — every row simply shows no age */
  }
  return dates;
}

/**
 * Where plan files live, from `## Plot Config` — never hardcoded, because Plot
 * contains no project's paths and an adopting repo renames this freely.
 *
 * The pulse names plans by basename, so the fleet needs a directory to rejoin
 * them to. A repo that cannot be asked falls back to the same default the
 * config helper documents, and a miss costs the waiting age and nothing else:
 * the parser is handed a path that does not exist, the map comes back empty,
 * and every row shows no age. Degrading to less rather than to wrong.
 */
async function planDirectory(opts: BuildBoardOptions): Promise<string> {
  try {
    const answer = await scriptsFor(opts).config('Plan directory', 'docs/plans/');
    if (!answer.ok) return 'docs/plans/';
    return answer.value.trim() || 'docs/plans/';
  } catch {
    return 'docs/plans/';
  }
}

/**
 * This repo's branch-URL prefix, read from `git remote get-url origin`.
 *
 * Read on the SCAN's timer, beside the branch ages, rather than per row or per
 * request: an origin changes about as often as a repo is re-cloned, and the row
 * count is what would multiply the cost. A repo with no origin (or no git at
 * all) yields "", and every branch then renders as plain text.
 */
async function readBranchUrlBase(opts: BuildBoardOptions): Promise<string> {
  try {
    return branchUrlBase(await run('git', ['remote', 'get-url', 'origin'], opts.repoRoot));
  } catch {
    return '';
  }
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
export function rateLimitBackoffMs(
  message: string,
  now?: number,
  fetchGraphqlResetMs?: () => Promise<number | null>,
): number | null | Promise<number | null> {
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
}

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
export function hostReaction(
  message: string,
  resetAt: number | null,
  now = Date.now(),
): Reaction | null {
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
}

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
export function waitOf(reaction: Reaction | null): number | null {
  if (reaction === null || reaction.waitMs <= 0) return null;
  return reaction.waitMs;
}

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
export function applyReaction(entry: CacheEntry, reaction: Reaction | null): void {
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
}

/** The limit reading the record last gave this board, in the shape rules read. */
function limitReadingOf(entry: CacheEntry): LimitReading {
  return {
    connector: entry.backend ?? '',
    bucket: '',
    limit: entry.prLimit,
    remaining: null,
    resetAt: entry.prResetAt,
    basis: entry.prLimitBasis,
  };
}

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
export function prConcurrencyBound(entry: CacheEntry): number | null {
  return concurrencyBound(boundFromLimit(limitReadingOf(entry)), entry.prConcurrency);
}

/**
 * `gh api rate_limit` IS NOT ASKED, AND `graphqlResetMs` IS GONE WITH IT.
 *
 * Both existed to answer *when does the budget return?* from the free
 * rate-limit endpoint. Measured 2026-09-01, three consecutive uncached readings
 * against the same account and moment:
 *
 *     rate_limit says graphql=5000   response header says=0
 *
 * and again in a quiet moment with nothing rate-limited: `/rate_limit` reported
 * `graphql 5000/5000, used 0` while a real call's headers read
 * `X-Ratelimit-Remaining: 4854, Used: 146`. **146 calls spent, reported as
 * zero.** A reset read from that endpoint is a number about a bucket it cannot
 * see.
 *
 * The authority is now the headers on a real response, which
 * `plot_harvest_headers` reads into the budget record and `spend-rate` reports
 * back as `resetAt`. Free where the endpoint was metered, and right where it
 * was wrong.
 */

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
export function prRefreshMsFor(
  backend: string,
  rate: { perHour: number | null } | null = null,
  currentMs?: number,
): number {
  const cost = prRequestsPerRefresh(backend);
  return refreshIntervalMs(PR_REFRESH_MS, cost, rate, currentMs ?? PR_REFRESH_MS * cost);
}

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
async function spendRateFor(
  opts: BuildBoardOptions,
): Promise<{
  perHour: number | null;
  resetAt: number | null;
  limit: number | null;
  basis: LimitBasis;
  account: string | null;
} | null> {
  try {
    const said = await scriptsFor(opts).hostSaid(['spend-rate']);
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
}

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
async function liveSlotsFor(entry: CacheEntry): Promise<number | null> {
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
}

/**
 * Whether a pid is alive, for the REPORTED count.
 *
 * The gate's own liveness test lives in the adapter, where it belongs; this is
 * the same question asked for a number nobody spends against, so it is asked
 * the same way rather than through a second mechanism that could disagree.
 */
function pidLooksAlive(pid: number): boolean | null {
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
}

async function withHostSlot<T>(entry: CacheEntry, call: () => Promise<T>): Promise<T> {
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
}

/**
 * What one refresh costs on `backend`, in host requests.
 *
 * An unknown backend costs 1 — see `PR_REQUESTS_PER_REFRESH`. Never 0, which
 * would make `prRefreshMsFor` return 0 and turn the gate into a tight loop: the
 * one arithmetic here that fails dangerously rather than merely wrongly.
 */
export function prRequestsPerRefresh(backend: string): number {
  const cost = PR_REQUESTS_PER_REFRESH[backend];
  return cost && cost > 0 ? cost : 1;
}

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
export function prGateOpen(
  nextAt: number, hard: boolean, now = Date.now(),
): boolean {
  if (hard) return now >= nextAt;
  return now + PR_TICK_SLACK_MS >= nextAt;
}

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
export function prNextDueAt(
  startedAt: number, backoff: number | null, now = Date.now(),
  backend = 'github',
  rate: { perHour: number | null } | null = null,
  currentMs?: number,
): { at: number; hard: boolean } {
  // BEFORE the cost is applied, and this ordering is the rule the brief names:
  // a cost-aware cadence may only ever be MORE conservative than a backoff,
  // never less. The host named this floor; stretching it would be conservative
  // and harmless, but shortening it would spend quota to be refused — so the
  // backoff is returned untouched and the multiplier never reaches it.
  if (backoff !== null) return { at: now + backoff, hard: true };
  return { at: startedAt + prRefreshMsFor(backend, rate, currentMs), hard: false };
}

/**
 * How many of a branch's own recent runs to fetch.
 *
 * Small on purpose. The question the history answers is *has this branch been
 * failing, or did it just start* — decided by the last few runs, and the
 * 2026-08-17 case was decided by the previous one alone (green two minutes
 * before the `403`). A longer list costs the same call and gives a reader more
 * to scroll past.
 */
const RUN_HISTORY_LIMIT = 5;

/**
 * The most FAILING branches to ask about in one PR refresh.
 *
 * Each is a separate REST call, so this is the one place the new evidence can
 * cost real budget. Failing branches are rare by construction — a fleet with
 * twelve of them has a bigger problem than a missing history — and the cap
 * bounds the pathological case rather than the normal one.
 *
 * A branch past the cap gets an empty history, which renders as *unavailable*:
 * the same honest degradation Bitbucket already gets, and never a claim that a
 * branch has not failed before.
 */
const RUN_FETCH_MAX = 8;

/**
 * A branch's own recent CI runs, for the branches whose PR already reports a
 * failure — the third line of the evidence a `ci-failing` row carries.
 *
 * ONLY FOR FAILING BRANCHES, and that restriction is what makes this affordable.
 * The board exhausted a 5000/hour GraphQL budget on 2026-08-16 by asking a
 * cheap question too often; this asks an expensive question rarely, on the
 * PR timer (60 s) rather than the git one (5 s), and only where a failure has
 * already been observed. A fleet with nothing failing issues no calls at all.
 *
 * FAILURE IS SILENT AND EMPTY, never partial-looking. A host that cannot answer
 * (Bitbucket has no run listing, an old `gh` lacks the flags) leaves the branch
 * with no history, which the row renders as *unavailable* — the same rule every
 * other absent signal here follows. It must never read as *this branch has
 * never failed before*.
 */
/**
 * Whether a branch's host answer can still change in a way a reader is waiting
 * for — the question the board spends its budget on, and the one it does not.
 *
 * THE MEASUREMENT THIS EXISTS FOR, taken 2026-08-27 after the scan batching
 * (#486) landed: the scan reads 24.2 % CPU — 6.61 s of work inside ~24 s of
 * wall clock. It is no longer computing; it is waiting on GitHub. So the lever
 * left is not to compute faster and not to refresh less often, but to ask fewer
 * questions per pass.
 *
 * A DERIVATION, NEVER A RECORD. Every input is this pass's own: the pulse the
 * scan just produced from git, and the PR map the host just answered with. No
 * verdict is written down, so there is nothing for git to invalidate and no
 * second source of truth to drift — the property `PLOT_TERMINAL_CACHE` already
 * has, and the reason no second cache was added here. A persisted verdict would
 * be a cache git cannot reach, which is precisely what the plan rejects.
 *
 * MERGED, NEVER CLOSED. A merged PR reports `state: CLOSED` through some host
 * projections, and squash-merge leaves a branch permanently "ahead of main", so
 * ancestry cannot decide merge state either. Only an explicit `MERGED` is
 * merged; a PR closed WITHOUT merging is a branch someone may still be waiting
 * on, and reading it as terminal would quietly stop reporting its CI.
 *
 * ABSENT IS NOT TERMINAL. A branch no plan mentions, or a pulse that has not
 * arrived yet, is watched. The board must never mistake *not known to be
 * finished* for *finished* — the rule every other absent signal here follows.
 *
 * @param branch the branch name, as the pulse and the PR head both spell it
 * @param pulse the scan's latest complete answer, or null before the first one
 * @param pr the branch's PR as the host reports it, or undefined where none is
 */
export function branchIsWatched(
  branch: string, pulse: FleetReading | null, pr: PrRecord | undefined,
): boolean {
  // The PR side: landed work cannot change. `MERGED` only — see above.
  if (pr && pr.state === 'MERGED') return false;
  // The plan side: `delivered` and `released` are the terminal phases, the same
  // pair `classify` treats as *nothing would move this row*. Read from the
  // pulse, which is re-derived from git every pass.
  if (pulse) {
    for (const plan of pulse.plans) {
      const phase = plan.phase.toLowerCase();
      if (phase !== 'delivered' && phase !== 'released') continue;
      for (const wave of plan.slices) {
        if (wave.branches.some((b) => b.branch === branch)) return false;
      }
    }
  }
  return true;
}

export async function refreshRuns(
  opts: BuildBoardOptions,
  entry: CacheEntry,
  prs: Map<string, PrRecord>,
  host: Host = hostFor(opts),
): Promise<void> {
  const runs = new Map<string, StuckRun[]>();
  const candidates = [...prs.entries()].filter(([, pr]) => pr.checks === 'failing');
  // WHAT A READER IS WATCHING, and nothing else. Applied BEFORE the cap, so the
  // eight slots go to branches whose answer can still move rather than being
  // spent on landed work — a fleet with nine merged failures and one live one
  // would otherwise fill the cap with history nobody is waiting on and render
  // the live branch's as *unavailable*.
  //
  // Re-derived here on every pass and stored nowhere. See `branchIsWatched`.
  const failing = candidates
    .filter(([branch, pr]) => branchIsWatched(branch, entry.pulse, pr))
    .slice(0, RUN_FETCH_MAX);
  // SKIPPING THE QUESTION MUST NOT DROP THE ANSWER. `runs` is rebuilt from
  // scratch each pass, so a branch this pass declines to ask about would lose a
  // history it already had — and a row losing a line it carried a minute ago
  // reads as the branch changing rather than as a fetch being skipped. That is
  // the same rule the catch below states for a failed fetch; a skipped one is
  // not a worse case than a failed one.
  const asked = new Set(failing.map(([branch]) => branch));
  for (const [branch] of candidates) {
    if (asked.has(branch)) continue;
    const previous = entry.runs.get(branch);
    if (previous) runs.set(branch, previous);
  }
  for (const [branch] of failing) {
    try {
      const answer = await withHostSlot(entry, () => host.runs(branch, RUN_HISTORY_LIMIT));
      if (!answer.ok) throw new Error('runs unavailable');
      // The adapter parses and normalizes; `BuildRun` and `StuckRun` are the
      // same four fields, so the copy below is a widening from readonly rather
      // than a second mapping. The JSON parse that used to sit here is the
      // adapter's, which is the whole move: a controller reading `--json`
      // output is a controller holding the host's wire format.
      const list: StuckRun[] = answer.value.map((r) => ({
        workflow: r.workflow,
        conclusion: r.conclusion,
        startedAt: r.startedAt,
        url: r.url,
      }));
      if (list.length > 0) runs.set(branch, list);
    } catch {
      // One branch's history is unavailable; the other two evidence lines
      // stand. Its LAST GOOD history is kept below rather than dropped — the
      // same rule the PR map and the pulse follow, and for the same reason: a
      // row losing a line it had a minute ago looks like the branch changing
      // rather than like a fetch failing.
      const previous = entry.runs.get(branch);
      if (previous) runs.set(branch, previous);
    }
  }
  entry.runs = runs;
}

/**
 * Every issue number any plan in the repo references, from the `Issue:` field.
 *
 * READS EVERY PLAN FILE, deliberately, and not `pulse.plans`. The pulse carries
 * active plans plus a rolling 24 hours of delivered ones — the right window for
 * BRANCHES, whose work stops being actionable once it lands, and the wrong one
 * for REFERENCES. A plan delivered last week is still the decision that was
 * made about its issue, and reading the pulse would drop it from this set and
 * put the issue back on the board a day later, under a heading that says nobody
 * has decided about it. The reference is what makes the row disappear, so it has
 * to outlive the branch.
 *
 * Affordable because it is ONE parser invocation over the whole directory:
 * measured at 132 ms for 59 plans here, on the 60 s PR timer. (The scan's
 * ~57 ms-per-plan figure prices one invocation per file, which is why it filters
 * before parsing; batched, the per-file cost is a fraction of that.)
 *
 * A failure returns null rather than an empty set: empty would mean "no plan
 * references anything", which would surface every issue in the tracker as
 * unplanned. Null lets the caller decline to answer instead.
 */
async function referencedIssues(opts: BuildBoardOptions): Promise<Set<number> | null> {
  const planDir = await planDirectory(opts);
  const dir = path.join(opts.repoRoot, planDir);
  let files: string[];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(dir, f))
      .filter((f) => {
        try { return fs.statSync(f).isFile(); } catch { return false; }
      });
  } catch {
    return null; // no plan directory to read — not a claim that nothing is planned
  }
  if (files.length === 0) return new Set();
  const referenced = new Set<number>();
  try {
    const answer = await scriptsFor(opts).planMeta(files);
    if (!answer.ok) return null;
    for (const line of answer.value.split('\n')) {
      if (!line.trim()) continue;
      const meta = JSON.parse(line) as { issues?: number[] };
      // Absent on an older parser, which is a repo whose plans cannot reference
      // issues at all — [] is then the true answer rather than a fallback.
      for (const n of meta.issues ?? []) referenced.add(n);
    }
  } catch {
    return null;
  }
  return referenced;
}

/**
 * Open tracker issues no plan references — the board's inbox.
 *
 * Runs on the PR timer beside `refreshPrs`, because it asks the same host at the
 * same cadence and its cost belongs to the same budget.
 *
 * THE THREE OUTCOMES STAY APART, and the port is where they are decided: it
 * answers `unaskable` for a host with no issue listing at all, `failed` for an
 * attempt that broke, and `answered` only on a clean exit. This function maps
 * those three words onto its own three, and reads no exit code to do it. A
 * failed lookup KEEPS the last good list, the same rule `refreshPrs` follows —
 * a row vanishing on a fetch error looks like someone planned the issue.
 */
export async function refreshIssues(opts: BuildBoardOptions, entry: CacheEntry): Promise<void> {
  const said = await scriptsFor(opts).hostSaid(['issue-list', '--limit', String(ISSUE_LIMIT)]);
  // `unaskable` is the adapter saying THIS HOST CANNOT BE ASKED — a standing
  // fact about Bitbucket, not an outage. It clears any stale error and empties
  // the list, because there is nothing to keep and nothing failed. The adapter
  // read the exit code; this reads the word.
  if (said.answer === 'unaskable') {
    entry.issues = [];
    entry.issueAnswer = 'unsupported';
    entry.issueError = null;
    return;
  }
  if (said.answer === 'failed') {
    const message = said.said;
    entry.issueAnswer = 'failed';
    entry.issueError = message; // `entry.issues` keeps its last good value on purpose
    // The issue poll is the neighbour the PR refresh's backoff never reached. It
    // runs on the SAME gate (`prNextAt`), so a rate limit HERE must push that
    // gate out too — otherwise the poll re-fires on the ordinary cadence and
    // spends the exhausted budget to be refused again. The wait comes from the
    // host's own message, exactly as the PR refresh derives it.
    // AWAITED because #272 gave this a second shape: where the message carries
    // no reset, it asks the host for the real one and returns a Promise. The
    // synchronous paths still return a number, so the await costs a microtask
    // and buys the caller one type instead of two.
    const reaction = hostReaction(message, entry.prResetAt);
    applyReaction(entry, reaction);
    const backoff = waitOf(reaction);
    if (backoff !== null) {
      // Measured from NOW — the host's "wait 90 seconds" starts when it said so.
      // EXTEND-ONLY: never pull the gate in. A longer backoff the PR fetch set a
      // tick earlier is a floor the host named, and this poll's own ceiling has
      // no business shortening it — the same "more conservative only" rule
      // `prNextDueAt` follows.
      const due = prNextDueAt(Date.now(), backoff, Date.now(), entry.backend ?? 'github');
      if (due.at > entry.prNextAt) {
        entry.prNextAt = due.at;
        entry.prNextIsBackoff = due.hard;
      }
    }
    return;
  }
  const raw = said.stdout;
  const open: { number: number; title: string; url: string; createdAt: string }[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const issue = JSON.parse(line) as
        { number: number; title?: string; url?: string; createdAt?: string };
      open.push({
        number: issue.number,
        title: issue.title ?? '',
        url: typeof issue.url === 'string' ? issue.url : '',
        createdAt: typeof issue.createdAt === 'string' ? issue.createdAt : '',
      });
    } catch {
      // One malformed line is not a reason to discard the rest, and not a
      // reason to call the whole lookup failed either.
    }
  }
  const referenced = await referencedIssues(opts);
  if (referenced === null) {
    // The plans could not be read, so "which of these is unplanned" has no
    // answer. Reporting the unfiltered list would surface issues that ARE
    // planned; reporting none would claim the inbox is clear. Neither is known.
    entry.issueAnswer = 'failed';
    entry.issueError = 'plans could not be read, so no issue can be called unplanned';
    return;
  }
  const now = Date.now();
  entry.issues = open
    .filter((i) => !referenced.has(i.number))
    .map((i) => {
      const at = i.createdAt ? Date.parse(i.createdAt) : NaN;
      return {
        // A ticket, stated rather than left to the consumer's call site — see
        // `IssueRowSchema.kind`. Every one of the seven kinds arrives the same
        // way, which is what lets one row component read slot 2 from the data.
        kind: 'ticket' as const,
        number: i.number,
        title: i.title,
        url: i.url,
        // Null rather than 0 where the host gave no date: 0 would claim the
        // issue was opened this instant.
        ageMinutes: Number.isNaN(at) ? null : Math.max(0, Math.round((now - at) / 60_000)),
      };
    });
  entry.issueAnswer = 'answered';
  entry.issueError = null;
}

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
async function resolveBackend(
  opts: BuildBoardOptions, entry: CacheEntry, host = hostFor(opts),
): Promise<string> {
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
}

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
function scheduleNextPr(
  entry: CacheEntry, startedAt: number, backoff: number | null, backend: string,
  rate: { perHour: number | null } | null,
): void {
  const interval = prRefreshMsFor(backend, rate, entry.prIntervalMs);
  const due = prNextDueAt(startedAt, backoff, Date.now(), backend, rate, entry.prIntervalMs);
  entry.prIntervalMs = interval;
  entry.prNextAt = due.at;
  entry.prNextIsBackoff = due.hard;
}

async function refreshPrs(opts: BuildBoardOptions, entry: CacheEntry): Promise<void> {
  // Captured BEFORE the call, and this is the whole fix. `prNextAt` is the
  // cadence's anchor, and anchoring it to the finish made every period cost the
  // call's duration — the tick meant to satisfy it arrived just too early, was
  // refused, and the next one came a period later. Anchoring to the start makes
  // the gate open exactly when the rigid interval tick arrives.
  //
  // `prAt` still stamps at the finish: it answers "how old is this DATA", and
  // data is not fetched until it has landed. Two questions, two stamps — the
  // one place they were the same number is the defect.
  const startedAt = Date.now();
  // Before the fetch, so BOTH exits have it — a failure reschedules too, and a
  // failure on Bitbucket must be spaced by the same cost as a success. Cached
  // after the first call, so this is one extra local `bash` on the process's
  // first refresh and nothing on any later one.
  // ONE ADAPTER FOR THE WHOLE REFRESH, bound here and passed down. Both
  // `resolveBackend` and `refreshRuns` default to `hostFor(opts)`, so leaving
  // them to their defaults would construct two adapters for one refresh — and
  // a fixture `Host` handed to only one of them would be obeyed by half the
  // pass, which is the failure a substitutable port exists to prevent.
  const host = hostFor(opts);
  const backend = await resolveBackend(opts, entry, host);
  // Read BEFORE the fetch, so all three exits divide by the same number and a
  // failure is spaced exactly as a success is. Reading it after would also
  // count this refresh's own line, which the board is about to subtract anyway.
  const rate = await spendRateFor(opts);
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
  try {
    // BOUNDED HERE, WHERE THE CALL IS. The gate wraps the host request and
    // nothing else — reading the record, parsing the answer and scheduling the
    // next refresh spend no host budget, and holding a slot across them would
    // count this board as a caller while it is not calling.
    const said = await withHostSlot(entry, () =>
      scriptsFor(opts).hostSaid(['pr-list', '--rich',
        '--state', 'all', '--limit', String(PR_LIMIT)]));
    // A refusal is thrown so the catch below keeps owning the backoff. It is one
    // policy — keep the last good map, wait where the host named a wait — and
    // the two paths that reach it (a refused call, and a map that came back all
    // `unknown`) must not grow two copies of it.
    if (said.answer !== 'answered') throw new Error(said.said);
    const out = said.stdout;
    const map = new Map<string, PrRecord>();
    const byNumber = new Map<number, PrRecord>();
    const byHead = new Map<string, PrRecord>();
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
      // A merged or declined PR must NOT reach `classify` by head: it would
      // answer for a branch whose git state has already answered, and reopen a
      // question the merge closed. Numbers are indexed regardless — a link to a
      // merged PR is exactly what a delivered plan's card wants.
      if (pr.head && pr.state === 'OPEN') map.set(pr.head, pr);
      byNumber.set(pr.number, pr);
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
      entry.prs = map;
      entry.prsByNumber = byNumber;
      entry.prsByHead = byHead;
      await refreshRuns(opts, entry, map, host);
      entry.prAt = Date.now();
      scheduleNextPr(entry, startedAt, null, backend, rate);
      entry.prError = null;
    }
  } catch (err) {
    // Same rule as the pulse: a failure keeps the last good map rather than
    // blanking it. An empty PR map would quietly move every row back to its
    // git-only group, which looks like state changing rather than data missing.
    const message = err instanceof Error ? err.message : String(err);
    entry.prError = message;
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
}

/**
 * Fetch PRs if the cadence gate allows it. Called from the PR timer and once at
 * start-up; the gate (`prNextAt`) is what turns a rate-limit into a wait rather
 * than a tighter loop, so nothing may bypass it.
 *
 * `prGateOpen` does not bypass it — it reads it correctly. A rate-limit backoff
 * is still compared exactly and still holds for its full delay; the tolerance
 * applies only to the ordinary cadence, where the timer and the gate are two
 * clocks trying to agree on the same instant.
 */
async function maybeRefreshPrs(opts: BuildBoardOptions, entry: CacheEntry): Promise<void> {
  if (entry.prRunning || !prGateOpen(entry.prNextAt, entry.prNextIsBackoff)) return;
  entry.prRunning = true;
  try {
    await refreshPrs(opts, entry);
    // On the SAME gate as the PR fetch, so the issue lookup cannot become a
    // second cadence quietly spending the host budget the gate exists to ration
    // — including its rate-limit backoff. Sequential rather than concurrent for
    // the same reason: two calls at one instant is what a rate limit counts.
    //
    // After, and outside `refreshPrs`, because the two fail independently: a
    // tracker outage must not blank the PR map, and a PR failure must not
    // retract the inbox.
    await refreshIssues(opts, entry);
  } finally {
    entry.prRunning = false;
  }
}

/**
 * Offer every branch in a landed pulse to the resolver, which refuses all but
 * one state.
 *
 * **This function classifies NOTHING.** It calls `stuckState` — slice 1's
 * detector, the same call `rowsFromPulse` makes with the same inputs — and hands
 * the answer to `mayResolve`. Two consequences, both deliberate:
 *
 * *The entry condition lives in one place.* A local `conflicts.includes(...)`
 * here would pass every artifact-only assertion and silently repair merges that
 * need judgement as a whole, while the fence in `stuck.ts` still read correctly.
 *
 * *A branch is offered on the same facts the row shows.* If the board says
 * `artifact conflict` and nothing is repaired, that is `mayResolve` refusing for
 * a reason a reader can check against the set printed on the row — not two
 * detectors disagreeing.
 *
 * The PR map is passed for one reason and used for none of the deciding: it is
 * what makes `prState` available to `stuckState`, and `prState === 'conflicts'`
 * is precisely the input that must produce a plain `conflict` — a host verdict
 * with NO OBSERVED SET, which this path may never act on.
 */
function maybeRepair(
  opts: BuildBoardOptions,
  pulse: FleetReading,
  prs: Map<string, PrRecord> | null,
): void {
  for (const plan of pulse.plans) {
    for (const wave of plan.slices) {
      for (const b of wave.branches) {
        const pr = prs?.get(b.branch) ?? null;
        const stuck = stuckState({
          state: b.state,
          conflicts: b.conflicts,
          conflictsKnown: b.conflicts_known,
          localAhead: b.local_ahead,
          prState: pr ? prState(pr) : null,
          changedPaths: b.changed_paths,
          failingChecks: pr?.failing_checks ?? [],
        });
        startRepair(b.branch, stuck, opts);
      }
    }
  }
}

async function refresh(opts: BuildBoardOptions, entry: CacheEntry): Promise<void> {
  if (entry.running) return;
  entry.running = true;
  // The last COMPLETE answer, held across a scan that will overwrite
  // `entry.pulse` many times before it finishes. `pulseShrink` asks what the
  // previous document had and this one lacks, and a partial view of the scan
  // in progress cannot answer that.
  const before = entry.pulseComplete ? entry.pulse : null;
  try {
    // FIRST, and before the scan spawns. The registry depends on neither git nor
    // the pulse — it reads `.plot/agents/` and the transcripts those manifests
    // point at — so it must not be behind anything that can fail. Two
    // consequences, both wanted:
    //
    //   * A branchless agent appears in NO plan, so nothing downstream would
    //     ever produce it. It exists only here.
    //   * A repo whose git momentarily failed still lists the agents whose
    //     manifests sit on disk. An agent invisible during an outage is an agent
    //     that gets restarted into work it is already doing.
    //
    // Assigned rather than merged: the directory is the whole truth about which
    // agents exist, so a manifest that was deleted must be able to disappear.
    // `scriptsDir` so the registry can reuse `plot-worker-state.sh` to refresh
    // each entry's liveness on this pulse — the same helper the fleet scan and
    // the dispatcher source. Without it every entry would read `unknown`, which
    // is honest but useless to the cap that will ask this count every pulse.
    // Drop settled workers from the listing: agents whose session has ended AND
    // whose worktree is clean (no uncommitted changes, no unpushed commits). Such
    // workers have nothing outstanding and clutter the panel — especially after a
    // fleet run where all workers finished successfully.
    //
    // The registry read now returns METADATA alongside entries — directory, manifest
    // count, synthesized count — so a synthesized fleet is legible. A reader seeing
    // `0 manifests, 12 synthesized` knows immediately that the drop menu is absent
    // because the board is reading an empty directory, not because nothing is broken.
    //
    // AWAITED, and the await is the slice's point rather than a detail. This
    // call sits FIRST in `refresh`, before any other, and `refresh` is started
    // — never awaited — by `ensureCache`, which every `/api/fleet` request goes
    // through. An async function runs synchronously up to its first `await`, so
    // while this was `execFileSync` its three forks (`plot-config.sh`,
    // `plot-worker-state.sh`, the cleanliness batch) ran ON the request thread
    // of whichever poll first warmed the cache. `void refresh(...)` reads like
    // fire-and-forget and was not one.
    const registryResult = await readAgentRegistryWithInfo(opts.repoRoot, undefined, {
      scriptsDir: opts.scriptsDir,
      cleanliness: bashCleanliness,
    });
    entry.agents = registryResult.entries;
    entry.registry = registryResult.info;
    // Default mode, WITH the fetch: the refresh is off the request path, so a
    // second of work is free — and the fetch is what lets the board see
    // branches a remote worker pushed. `--stream` is the only flag added.
    //
    // STREAMED rather than awaited whole. The scan is 18.3 s on 84 branches
    // against a 5 s refresh, and git alone is 12.7 s of that — so the wait is
    // structural and no host fix removes it. What removes it is not waiting for
    // the whole document: a plan is rendered when that plan resolves.
    //
    // `parsed` is filled by the terminal line and is null until then. Every
    // partial write below goes through `entry`, never through this — the
    // difference between "the scan finished and said this" and "this much has
    // arrived so far" is the one this whole function is organised around.
    let parsed: FleetReading | null = null;
    // What has arrived THIS scan, accumulated apart from `entry.pulse`.
    //
    // Starts empty rather than from the last pulse, because a plan that has
    // vanished from the scan must be able to disappear — seeding from the
    // previous answer would make deletion impossible and turn the cache into a
    // record. It is COMPOSED with the previous pulse on each write (see
    // `renderable`), which is what lets rows stay on screen meanwhile.
    let arrived: FleetReading['plans'] = [];
    // The previous scan's plans, held for exactly as long as this scan is
    // partial. A plan the new scan has not reached yet keeps rendering from
    // this; one the new scan HAS reached is overwritten by what it said.
    const previous = entry.pulse?.plans ?? [];
    /**
     * Publish what has arrived, composed over what was already on screen.
     *
     * The composition is the reason a streaming board does not flicker: at line
     * one the tab would otherwise drop 23 of 24 plans and grow them back, which
     * reads as the board losing the fleet rather than refreshing it. Plans this
     * scan has spoken about win; plans it has not reached yet stay as they were.
     *
     * `pulseComplete` is false throughout, so every consumer can tell this from
     * a finished answer. `summary` is RECOUNTED from these plans rather than
     * carried over — a summary describing 24 plans beside 3 plan rows is a
     * measurement of one document presented as a measurement of another, which
     * is the exact shape of dishonesty this branch exists to remove.
     */
    const publishPartial = (): void => {
      const spoken = new Set(arrived.map((p) => p.file));
      const plans = [...previous.filter((p) => !spoken.has(p.file)), ...arrived];
      // The head fields come from the last complete pulse until the terminal
      // line replaces them. They describe WHICH WORLD the answer is about, and
      // the streamed plan lines carry no such field — inventing one here would
      // assert a ref this scan never reported.
      entry.pulse = {
        main: entry.pulse?.main ?? '',
        head: entry.pulse?.head ?? '',
        read_ref: entry.pulse?.read_ref,
        local_head: entry.pulse?.local_head,
        plans,
        summary: partialSummary(plans),
      };
      entry.pulseComplete = false;
    };
    // What this pulse learns about terminal branches. Accumulated separately
    // and only installed on SUCCESS, below: a scan killed at the 30 s timeout
    // has reported some entries and re-derived others, and adopting that
    // partial map would quietly drop the branches it never reached — turning
    // a slow pulse into a cold cache on the pulse after it.
    let learned = '';
    await scriptsFor(opts).stream(FLEET_SCAN, ['--stream'],
      (line) => {
        // A line that does not parse is DROPPED, not fatal. The scan writes its
        // document to stdout and its notes to stderr, but a helper that ever
        // prints to the wrong stream would otherwise abort a scan whose plans
        // were all correct. What the board loses is one line; what it would
        // lose by throwing is the whole partial answer.
        let msg;
        try {
          msg = FleetScanLineSchema.parse(JSON.parse(line));
        } catch {
          return;
        }
        if (msg.kind === 'plan') {
          arrived = mergePlan(arrived, msg.plan);
          publishPartial();
          return;
        }
        // The terminal line: the scan finished and this is the whole document.
        parsed = msg.reading;
      },
      {
        timeoutMs: FLEET_SCAN_BUDGET_MS,
        // The map this pulse starts from. `''` on the first pulse after a
        // restart, which is what makes a restart re-derive everything.
        env: { PLOT_TERMINAL_CACHE: entry.terminal },
        onErrorLine: (line) => {
          // Only the tagged notes are read; everything else on stderr is the
          // scan's ordinary prose and stays discarded.
          if (line.startsWith('terminal:')) {
            learned += `${line.slice('terminal:'.length).trim()}\n`;
          }
        },
      });
    // A scan that exited 0 without its terminal line described nothing it can
    // be held to. Treated as a failure rather than as an empty fleet, for the
    // reason the catch below states: replacing real state with emptiness is
    // what makes a monitoring view untrustworthy. Whatever arrived stays, and
    // `pulseComplete` stays false so the tab says the rest is unknown.
    if (parsed === null) throw new Error('fleet scan ended without a terminal pulse line');
    // ADOPTED ONLY NOW — past every way this scan could have failed. The scan
    // re-reports the entries it served as well as the ones it learned, so what
    // arrived is the WHOLE map for the next pulse and replaces rather than
    // merges. Merging would be the bug the plan names: an entry no scan
    // re-derived would survive on nothing but its own age.
    entry.terminal = learned;
    const complete: FleetReading = parsed;
    // Against `before`, captured at the top of this function — because
    // `entry.pulse` stopped being the previous answer the moment this scan
    // published its first plan. That capture is what keeps the sentence below
    // true now that the assignment is no longer the only moment both answers
    // exist.
    //
    // The success path's half of the cache's one-directional rule. Three lines
    // down, a FAILED scan is refused the right to overwrite a good result; this
    // is the case that rule missed, because it assumed the only way to be less
    // informative was to fail. A scan that exits 0 and describes fewer plans is
    // accepted — it may be right, and a view that cannot shrink keeps dead rows
    // forever — but it is MARKED, so the tab degrades rather than hiding.
    //
    // Overwritten on every success, including with null: this describes the
    // latest transition, not a history. A scan that recovers the missing plans
    // clears the mark, which is the behaviour that makes a populated one worth
    // looking at.
    // Comparing a finished scan to the partial view of itself would report the
    // shrink as zero every time, because the two are the same document; the
    // question this field answers is what the LAST COMPLETE answer had that
    // this one does not.
    entry.shrink = pulseShrink(before, complete, entry.at);
    entry.pulse = complete;
    // The scan finished and said this, so the composition above is retired: no
    // plan is being carried over from a previous answer any more. Set beside
    // the pulse it describes, never later — a gap between the two is a window
    // where a complete document reads as partial.
    entry.pulseComplete = true;
    entry.ages = await branchAges(opts);
    entry.branchUrlBase = await readBranchUrlBase(opts);
    entry.approvedAt = await approvalDates(opts, complete);
    // From the REFS, not from `entry.prs`. The PR map is filled on its own
    // 60 s timer, so at the first git refresh it is still null — the list came
    // back empty and nothing recomputed it, because this timer does not watch
    // that one. Two clocks, one dependency: the same shape that pinned the
    // countdown at zero earlier today.
    entry.ideaPlans = await ideaPlanFiles(opts);
    // THE RELEASE VERSION, from the release branch's own `package.json`. From
    // the REFS for the reason stated one line up: the PR map is on its own
    // timer and is still null at the first git refresh.
    entry.versions = await releaseVersions(opts);
    // WHICH BRANCHES STILL CARRY WORK, from the refs for the reason stated
    // above: this is a question about git, and the PR map is on its own timer.
    // `complete.main` rather than a literal — the default branch is the pulse's
    // to name, and a repo whose trunk is not `main` must not have every one of
    // its branches read as unmerged.
    entry.unmerged = await unmergedBranches(opts, complete.main);
    // WHAT THE WAITING WORKERS ASKED, read here and nowhere else.
    //
    // After `entry.pulse` is assigned, because the pulse is what says WHICH
    // branches are waiting and where their worktrees are — this reads no
    // directory the scan did not just report.
    //
    // Costs nothing on a fleet with no questions in it: `workerQuestions`
    // returns immediately when the pulse names no `waiting` branch with a local
    // worktree, so the ordinary refresh spawns nothing at all.
    entry.questions = await workerQuestions(parsed);
    entry.at = Date.now();
    entry.error = null;
    // The one place the bridge is written, and it is INSIDE the success path on
    // purpose. A scan that failed must not overwrite the last good answer — the
    // same one-directional rule the in-memory cache obeys three lines down, and
    // the only thing standing between a `--watch` restart and an empty board.
    writeBridge(opts.repoRoot, {
      at: entry.at,
      pulse: complete,
      ages: entry.ages,
      branchUrlBase: entry.branchUrlBase,
      approvedAt: entry.approvedAt,
      ideaPlans: entry.ideaPlans,
    });
    // THE ONE AUTOMATIC WRITE, and it rides this timer rather than a request.
    //
    // On the SCAN's clock and inside its success path, for the reason the bridge
    // write above is: a repair may only be started from a pulse that actually
    // landed. Starting one from a failed scan would act on the last good
    // answer — refs that may have moved — which is the stale-prediction mistake
    // this plan named and then licensed nothing on top of.
    //
    // Off the REQUEST path entirely, which is what keeps the guard on
    // `/api/dispatch` untouched. That route asks *where is the caller*, and a
    // firing interval passes that trivially — so this deliberately never becomes
    // a route at all. It is not reachable over the network, from any binding,
    // localhost included: there is nothing to reach.
    //
    // `startRepair` decides. This loop only offers it every branch and it
    // refuses all but one state — see `mayResolve`.
    maybeRepair(opts, complete, entry.prs);

    // THE SECOND AUTOMATIC WRITE — slice 3, the switch that does something.
    //
    // Beside `maybeRepair` and of the same kind: on the SCAN's clock, inside its
    // success path, from a pulse that actually landed — a dispatch from a failed
    // scan would act on refs that may have moved. Off the request path entirely,
    // so it is a route nobody can reach.
    //
    // Reads the controls FRESH so a switch flipped this pulse takes effect now,
    // and counts liveness from `entry.agents`, the registry this same refresh
    // just repopulated. The in-flight set is the ONE piece of state that spans
    // pulses — assigned whole, never mutated, so the cache's one-directional
    // rule holds. It withholds the next dispatch when the switch is off or the
    // cap is at its live count; it NEVER signals a running worker.
    //
    // THE MACHINE READING is taken here, on the scan's clock, and handed in as
    // a VALUE — `maybeAutoDispatch` stays synchronous and `planAutoDispatch`
    // stays pure. One reading per pulse, shared, rather than one per agent:
    // measuring per agent would multiply the very cost it measures
    // (`DESIGN-machine.md` §9). The sampling is time-bounded in the adapter, so
    // a starved machine costs a bounded amount to detect rather than
    // `samples x spawnCostMs`.
    const machine = await readMachine(opts);
    entry.autoInFlight = maybeAutoDispatch(
      opts,
      complete,
      await readFleetSettings(opts),
      entry.agents,
      entry.autoInFlight,
      machine,
    );

    // THE THIRD AUTOMATIC WRITE — a finished plan delivers itself, and its
    // desks are cleared behind it.
    //
    // Beside the two above and of exactly the same kind: on the SCAN's clock,
    // inside its success path, from a pulse that actually landed. Off the
    // request path entirely, so it is a route nobody can reach.
    //
    // LAST of the three, which is not arbitrary. `maybeAutoDispatch` starts work
    // and this finishes it, so running it after means a branch dispatched this
    // pulse is already counted live before anything asks whether its plan is
    // done. And it reaps, which removes worktrees the two writes above read.
    //
    // The board writes NONE of the transition: `maybeAutoDeliver` calls
    // `plot-deliver.sh`, which flips the phase, writes the `Delivered:` record
    // and moves the index symlink in one commit — then, and only on its success,
    // reaps. See `auto-deliver.ts` for why the ordering is a listener rather
    // than a second spawn.
    entry.deliverInFlight = maybeAutoDeliver(opts, complete, entry.deliverInFlight);
  } catch (err) {
    // A failed refresh NEVER overwrites a good result. Replacing real state
    // with emptiness because one scan failed is what makes a monitoring view
    // untrustworthy — the tab keeps the last pulse, its age, and this error.
    const message = err instanceof Error ? err.message : String(err);
    // A TIMEOUT SAYS WHAT IT COUNTED, NOT WHAT MADE IT SLOW. `withEstate`
    // appends the two measured counts only when this is a budget overrun and
    // they could be read — a scan that failed any other way, or a repo that
    // could not be probed, keeps the bare message. The counts are paid here, on
    // the failure path, because it is the only path that needs them and the scan
    // is already dead.
    //
    // They describe the estate; they do not diagnose the scan. This comment
    // claimed the stronger thing until the claim was tested against reality —
    // 81 % of a 131 s scan was measured OUTSIDE git, so the estate cannot be the
    // explanation, whatever its size. Naming the plan the scan died in would be
    // a real diagnosis and `--stream` makes it reachable; that is the follow-up,
    // not this.
    entry.error = isTimeout(message)
      ? withEstate(message, await measureEstate(opts))
      : message;
  } finally {
    entry.running = false;
  }
}

/**
 * A cache entry as a fresh process starts one — every field at its cold-start
 * value, nothing bridged in. The ONE definition of that shape, so a test can
 * build an entry the same way the server does rather than copying a literal
 * that would drift from this one.
 */
export function freshCacheEntry(): CacheEntry {
  return {
    pulse: null, ages: new Map(), at: null, error: null, shrink: null, branchUrlBase: '',
    // Empty at construction, which is the whole of "a restart re-derives
    // everything": nothing survives this process, so the first pulse is cold.
    terminal: '',
    approvedAt: new Map(),
    ideaPlans: new Map(),
    versions: new Map(),
    // Empty until the first scan, which is *nothing measured* rather than
    // *nothing unmerged* — see {@link unmergedBranches}. No row is added from an
    // empty set, so a board that has not scanned yet looks exactly as it did
    // before this field existed.
    unmerged: new Set(),
    questions: new Map(),
    // `unsupported` before the first lookup, never `answered`: a board that
    // has not asked must not render an empty inbox as a clear one.
    issues: [], issueAnswer: 'unsupported', issueError: null, agents: [], registry: undefined,
    // Empty at construction — nothing was dispatched before this process began,
    // and a restart re-derives liveness from git rather than trusting a set.
    autoInFlight: new Set(),
    deliverInFlight: new Set(),
    prs: null, prsByNumber: null, prsByHead: null, runs: new Map(), prAt: null, prError: null, prSpendPerHour: null,
    prResetAt: null, prConcurrency: PR_CONCURRENCY_START,
    prLimit: null, prLimitBasis: 'unknown', prAccount: null, prSlotsHeld: null,
    // 0, so the first fetch happens immediately rather than a minute in.
    prNextAt: 0, prNextIsBackoff: false, prIntervalMs: PR_REFRESH_MS,
    // Null, never 'github': "not yet asked" and "asked, and it is GitHub" are
    // different answers, and `resolveBackend` distinguishes them to ask once.
    backend: null,
    pulseComplete: true,
    // Null, not a stopped clock: `ensureCache` starts the pulse, and a fresh
    // entry has not been through it yet.
    pulseClock: null, running: false, prRunning: false,
  };
}

function ensureCache(opts: BuildBoardOptions): CacheEntry {
  const key = cacheKey(opts);
  let entry = caches.get(key);
  if (entry) return entry;

  entry = freshCacheEntry();
  caches.set(key, entry);
  // THE BRIDGE, read once — the only read in the process's life.
  //
  // A `node --watch` restart takes this cache with the process, and a freshly
  // started board therefore had nothing to degrade to: measured on 2026-08-17,
  // `0 branches across 0 plans` while five agents were working. The file is the
  // previous process's last good answer, and serving it labelled with its real
  // age is #141's *degrade, do not hide* applied to the server's own side of
  // the same failure.
  //
  // `entry.at` is the SCAN's timestamp, not this moment: the page's age, its
  // banner and its stopped clocks are all driven from it, so a bridged pulse
  // must age from when it was true rather than from when it was loaded. Passing
  // `Date.now()` here would present a payload from ten minutes ago as fresh,
  // which is the one thing worse than showing nothing.
  //
  // Null covers every way of not having one — no file, unreadable, a foreign
  // shape, or simply too old to mean anything — and leaves the cold-start
  // behaviour exactly as it was.
  const bridged = readBridge(opts.repoRoot);
  if (bridged) {
    entry.pulse = bridged.pulse;
    entry.ages = bridged.ages;
    entry.branchUrlBase = bridged.branchUrlBase;
    entry.approvedAt = bridged.approvedAt;
    entry.ideaPlans = bridged.ideaPlans;
    entry.at = bridged.at;
  }
  // Warm at startup so the first person to open the tab does not wait a second
  // for it; until this lands the endpoint reports `ready: false`. Both sources
  // are warmed — the slower cadence must not mean the tab opens with no PR data
  // for a minute.
  //
  // Issued BESIDE the bridge read, never instead of it, and the pair is
  // deliberate: a scan costs 500–1050 ms (21.2 s measured on a cold boot), so
  // scanning alone narrows the empty window without closing it, and a `--watch`
  // restart storm reopens it on every save; the file alone would leave the
  // board stale until this lands. The file covers the gap, the scan ends it —
  // and when it lands it overwrites every field set above, so a real answer
  // always wins over the bridged one.
  void refresh(opts, entry);
  void maybeRefreshPrs(opts, entry);
  // ONE CLOCK, TWO DIVISORS, where there were two timers.
  //
  // This cache key IS the machine's identity — `repoRoot + scriptsDir`, which
  // is what distinguishes three Plot instances on one laptop — so one pulse per
  // entry is `DESIGN-pulse.md`'s *one machine, one pulse* rather than a timer
  // per repository that happens to look like one.
  //
  // The isolation the two timers bought is NOT spent here. It moved into
  // `beat`, which dispatches synchronously and awaits nothing: git is local and
  // free at 5 s, the host is metered and pointless below a minute, they failed
  // independently already, and they still fire independently. A rate-limited
  // host cannot stall the git scan that has nothing to do with it.
  const pulse = startPulse(clockSystem(), REFRESH_MS);
  entry.pulseClock = pulse;
  // The tick per subscriber, looked up by name rather than chosen by a
  // condition: a `name === 'fleet-scan' ? … : …` would wire the PR reader twice
  // on a typo, silently, and both cadences would then be 60 s.
  const ticks: Record<string, () => Promise<void>> = {
    'fleet-scan': () => refresh(opts, entry!),
    'pr-reader': () => maybeRefreshPrs(opts, entry!),
  };
  for (const { name, everyNthBeat } of boardDivisors()) {
    pulse.add({ name, everyNthBeat, tick: ticks[name] });
  }
  return entry;
}

/**
 * The board's two subscribers, and the divisor each one counts by.
 *
 * DERIVED FROM THE BASE, never written down. `12` is right only because the
 * base is 5 s — `divisorFor` reads it off `REFRESH_MS` and `PR_REFRESH_MS`, so
 * moving either constant moves the cadence with it and no literal has to be
 * found and edited. That is the whole reason a subscriber names a divisor
 * rather than a period.
 *
 * Exported so a test can assert the cadences the board actually wires, rather
 * than grepping this file for a number. What it returns IS what `ensureCache`
 * subscribes; there is no second list.
 *
 * @returns the scan at every beat, and the PR reader at every twelfth.
 */
export function boardDivisors(): { name: string; everyNthBeat: number }[] {
  const base = createPulse(REFRESH_MS, 0);
  return [
    // 1: git is local and free, so the scan takes every beat.
    { name: 'fleet-scan', everyNthBeat: divisorFor(base, REFRESH_MS) },
    // 12: the host is metered, and firing it at 5 s spent a 5000/hour budget in
    // a working day — measured 2026-08-16, `remaining 0/5000, used 5007`.
    { name: 'pr-reader', everyNthBeat: divisorFor(base, PR_REFRESH_MS) },
  ];
}

/**
 * PR records by number from the fleet cache, or null while none has landed.
 *
 * Never runs the adapter inline — same rule as `buildFleet`, and the reason the
 * board stays fast. `ensureCache` only *starts* the background refresh (it
 * returns before the first fetch resolves), so an early board request returns
 * null and its cards render PR numbers without links until the next poll picks
 * them up. Absent data, rendered as absent rather than waited for.
 */
export function prsByNumber(opts: BuildBoardOptions): Map<number, PrRecord> | null {
  return ensureCache(opts).prsByNumber;
}

/**
 * The cached fleet pulse, or null while none has landed.
 *
 * The same shape and the same rules as `prsByNumber` above — synchronous, never
 * runs the scan inline, null on a cold cache. It exists so a board CARD can
 * report claimed/eligible counts from git rather than from a plan annotation
 * nobody writes: a claim is a pushed ref, and this is where the board already
 * knows about refs.
 *
 * Null must not be flattened into zeros by callers. "No pulse yet" and "nothing
 * is claimed" are different answers, and rendering them alike is the defect
 * this export was added to remove.
 */
export function pulseFor(opts: BuildBoardOptions): FleetReading | null {
  return ensureCache(opts).pulse;
}

/**
 * Whether the cached pulse is EVERY plan the scan found, or only what had
 * arrived before it was cut short.
 *
 * The companion `pulseFor` needs and cannot carry: a `FleetReading` describes the
 * plans in it and says nothing about the ones missing from it, so completeness
 * lives beside the pulse on the cache entry (`pulseComplete`) and travels as its
 * own answer. `/api/board` already publishes it as `complete`; this is the same
 * field for the server-side readers that gate on it.
 *
 * True on a COLD cache, matching `pulseComplete`'s own default and for the same
 * reason: `pulseFor` already returns null there, and "nothing has arrived" is
 * said once rather than twice. A caller holding a null pulse learns nothing from
 * this and must not read `true` as *the scan finished*.
 *
 * Read by the delivery gate, where the distinction decides an operator's action:
 * a plan absent from a PARTIAL pulse has not been reached, and reading that as
 * "its branches have not merged" is the defect this pair of accessors ends.
 */
export function pulseCompleteFor(opts: BuildBoardOptions): boolean {
  return ensureCache(opts).pulseComplete;
}

/** Stop the refresh clocks. Tests need this; the server never calls it. */
export function stopFleetRefresh(): void {
  // One `stop` per entry where there were two `clearInterval`s: both cadences
  // are subscribers on the one clock, so stopping it stops both.
  for (const entry of caches.values()) entry.pulseClock?.stop();
  caches.clear();
}

/**
 * Which board phase a ROW is in — from the PAIR, never from the plan file alone.
 *
 * The obvious implementation carries the plan's phase onto its rows and maps it
 * with `toBoardPhase`. Once that mapping reads `approved` as Development
 * regardless of `started`, the row's word and the board's column agree for an
 * approved plan whatever git says — which is the point of the Design-is-a-phase
 * change: an approved-but-unstarted plan is Development, waiting for an agent,
 * on both surfaces. `toBoardPhase` stays the single definition of the mapping
 * and gains no second implementation here; this function composes it with the
 * branch state, and every phase word it can return came out of that call.
 *
 * The `started` half it supplies from git no longer moves an approved plan, but
 * it is still read and still passed, so this function keeps composing the one
 * mapping rather than restating it — and the moment `toBoardPhase` grows a
 * phase that forks on `started` again, the composition is already in place.
 *
 * TWO PLACES THE COMPOSITION IS DELIBERATELY NOT SYMMETRIC — kept because they
 * describe intent, even where the current mapping makes them return the same
 * value the fall-through would.
 *
 * **"git wins" applies to an ABSENT record, not to a recorded decision.** A
 * commit landing under a plan already marked `delivered` does NOT pull the row
 * back to Development. The two cases are not mirror images: a missing `Started:`
 * line is nobody having written something down, and evidence outranks an
 * absence; a commit after delivery contradicts something a human recorded, and
 * a follow-up fix does not repeal it. Sending a plan visibly backwards for a
 * typo fix teaches readers to distrust the column. The commit is not hidden —
 * the row's age still shows something moved.
 *
 * **`deferred` reads the row from the plan's own phase, git ignored.** The
 * annotation does not mean "paused, resuming later": the vocabulary is explicit
 * that the branch *isn't needed* and was *given up deliberately*, and
 * `plot-deliver` skips deferred branches in its completeness gate — a plan
 * delivers without them. So the row returns to where it is decided whether the
 * branch is wanted at all, which is the plan's own phase. (With the Design fork
 * gone this equals the started mapping for every phase, but the intent stands:
 * a handed-back branch answers to the plan, not to its commits.)
 *
 * The `deferred` FACT is not carried by the phase — a bare Development row is
 * indistinguishable from one an agent is on. `state` carries it, and the row
 * renders a badge from that.
 */
// A PHASE IS A DOMAIN RULE. `rowPhase` moved to
// `packages/domain/src/rules/phase.ts`; imported for this file's own use and
// re-exported for the callers that already look here.
export { rowPhase };


/**
 * Which group a branch belongs to, and why.
 *
 * Two sources, in a deliberate order. A branch WITH a PR is answered by the PR:
 * once work is up for review, what it waits for is decided there rather than by
 * commit age. Everything else — merged, unpushed, claimed-but-empty — is
 * answered by git, exactly as before PR data existed.
 *
 * Every group still renders even when empty. An absent group is
 * indistinguishable from an empty one, and `waiting-on-machine` showing nothing
 * must mean "no CI is running", not "the board cannot tell".
 */
/**
 * What a NOT-STARTED row is waiting for — the field the colour reads.
 *
 * A SEPARATE function rather than a fourth return value on `classify`, which
 * already takes nine parameters and answers a different question: `classify`
 * decides which SECTION a row belongs to, this decides what a row in one
 * section is waiting for. Splitting them keeps each one testable against its
 * own inputs, and keeps this one pure enough to assert exhaustively.
 *
 * It takes the same inputs `classify` uses for the same rows, so the two cannot
 * disagree — and the group is passed in rather than re-derived, so a row that
 * `classify` placed elsewhere gets `null` by construction instead of by a
 * matching rule that could drift.
 *
 * The order is the same as `classify`'s and that is deliberate: an earlier slice
 * outranks a Draft plan, because both are true of a Draft plan's later slices
 * and the slice is the more specific statement. Saying the weaker of two true
 * things is how a note stops being worth reading — and the colour must not
 * contradict the note beside it.
 *
 * DEFERRED joins DRAFT under `you`. Both wait on a person with no clock
 * running; they differ in which action — approve versus un-shelve — and the
 * note already says which.
 *
 * WITHIN A PLAN THAT CAN STILL MOVE, and that bound is `classify`'s to keep
 * rather than this function's. A deferred branch of a `Delivered` or `Released`
 * plan waits on nobody — the plan shipped and the shelf is part of its history
 * — so `classify` sends it to DONE and the group guard above answers null for
 * it. This function does not repeat that test: it derives from `group` for the
 * same reason the Draft arm was deleted rather than left unreachable, and a
 * second copy of the phase rule here would be the drift that pairing prevents.
 */
/**
 * Does this PR ask NOTHING of a person right now?
 *
 * **A draft is still the author's.** A draft PR says "I am not finished" — it
 * is the clearest possible WORKING row.
 *
 * **Pending is waiting on CI, not on review.** A pending PR's checks are still
 * running — no person can review it yet.
 *
 * **A green non-draft PR needs review.** This is the #389/#390/#391 fix: three
 * ready green PRs sat reviewable and invisible because they were treated as
 * "asking nobody" while their workers ran. A green non-draft PR says "I am
 * finished and need review" — it IS somebody's errand.
 *
 * The 2026-08-17 fix that added `green || pending` here was scoped one notch
 * too wide for GREEN: that defect was an agent whose DRAFT PR went green,
 * still the author's, still WORKING. Green non-draft is now excluded.
 */
export function prAsksNobody(pr: PrRecord): boolean {
  if (pr.draft) return true;
  const s = prState(pr);
  return s === 'pending';
}

export function waitingOnFor(
  group: WaitingGroup,
  state: BranchState,
  verdict: string,
  planPhase: string | null,
): WaitingOn | null {
  if (group !== 'not-started') return null;
  // A shelved branch waits on a person — a deliberate hand-back. It reaches
  // `not-started` by its own route, never through the `open` arm below.
  //
  // THAT ROUTE IS NOW GUARDED, and this line is correct because of it rather
  // than in spite of it. It once read *the one row here that a phase check does
  // not account for*, and that was true and was the defect: a deferred branch of
  // a plan Released four months earlier answered `you`, naming a person who had
  // nothing left to do. `classify` now asks the plan's phase in the deferred arm
  // as well, so a finished plan's shelf leaves the section entirely and the
  // group guard above returns null before this line can run.
  //
  // So the answer is UNCHANGED and its scope is narrower: every deferred row
  // still reaching here belongs to an APPROVED plan — the only phase whose
  // shelved branch stays in NOT STARTED. A DRAFT plan's shelf leaves for WAITING
  // ON YOU in the deferred arm, and a finished plan's leaves for DONE, so both
  // are gone before the group guard above lets this run. For an approved plan
  // the hand-back is real: somebody shelved this branch and somebody may
  // un-shelve it, which is a person, with no clock running. The note beside the
  // colour says which action.
  if (state === 'deferred') return 'you';
  if (state !== 'open') return null;
  // An earlier slice, WITHIN an approved plan — which is now the only kind of
  // plan whose open branches reach this section at all.
  if (verdict !== 'eligible') return 'time';
  // THE DRAFT ARM IS GONE, and its absence is the point rather than an
  // oversight. It used to answer `you` for a Draft plan's first slice, because a
  // Draft plan's branches sat in NOT STARTED and needed a colour saying they
  // could not be taken. They no longer sit here: `classify` sends the whole
  // plan to WAITING ON YOU, so the guard above returns null before this line
  // could run.
  //
  // Deleted rather than left unreachable. A dead arm here is a SECOND rule
  // asserting that Draft rows belong in this section — the drift this function
  // exists to prevent, and the reason it derives from `group` rather than
  // re-deciding it. The concern the old arm answered is answered better by the
  // move: a four-slice Draft plan no longer puts four loud rows on the board for
  // one pending approval, because it puts none.
  //
  // `planPhase` stays in the signature: the caller reads it from the same pair
  // of facts, and a parameter removed here would silently shift the argument
  // list of every spread-tuple caller in the suite — a trap this file has
  // sprung once already.
  void planPhase;
  return 'click';
}

/**
 * WHETHER THIS ROW CAN BE STARTED — the four verdicts, computed from the same
 * facts `waitingOnFor` reads but answering a different question.
 *
 * `waitingOnFor` answers *what is this row waiting for* — a colour, visible on
 * every row in NOT STARTED. This answers *can I start this*, a yes/no that
 * earns a word only where the question applies: approved plans with eligible
 * branches, and the three reasons such a branch cannot be taken.
 *
 * ## The four verdicts
 *
 *   `start-work`           brief present, slice eligible, plan approved
 *   `needs-brief`          slice eligible, plan approved, no brief
 *   `waiting-on-approval`  plan is Draft — approve it or leave it
 *   `someone-is-on-it`     `wip` or `claimed` — not yours to start
 *
 * NULL where the question does not apply: a merged branch is finished work, a
 * deferred branch was deliberately shelved, a blocked branch cannot advance
 * until an earlier slice lands. The row renders no startability word for any of
 * them, rather than a word that closes the question.
 *
 * ## Why the branch state gates the whole function
 *
 * `wip` and `claimed` are evidence SOMEBODY HAS IT. A claim is a pushed ref,
 * checked atomically by `plot-dispatch.sh`; `wip` is uncommitted work on a
 * previously-open branch. Both mean the branch is taken, whatever the plan
 * phase says.
 *
 * `merged` is finished work. Finished work is not someone working, and
 * startability does not apply — there is nothing to start.
 *
 * `deferred` was deliberately shelved. A shelved branch waits on a person who
 * *un-shelves* it, which is a different act from *starts* it; `someone-is-on-it`
 * would be the wrong answer and `start-work` would be a lie.
 *
 * `open` is the one state that can be started, and every guard after it refines
 * that question.
 *
 * ## Why null is not a fifth verdict
 *
 * A verdict that says *this question is inapplicable* is indistinguishable from
 * a value a server predating the field never computed. Both render the same:
 * silence. But the null is not a DEFAULT — it is the honest answer for every
 * row outside `not-started`, and for every merged, deferred or blocked branch
 * inside it.
 *
 * @returns One of the four verdicts, or null where none applies.
 */

/**
 * The slice verdict as a VALUE, or null where the scan did not report one this
 * board recognises.
 *
 * `classify` takes `verdict` as a `string` — it is a field off a JSON pulse, and
 * an older or newer scan may put anything in it — so the row's typed field needs
 * this one gate between the two. Parsed rather than cast: a cast would put an
 * unrecognised word on the row as though the scan had said it.
 *
 * NULL FOR EVERYTHING ELSE, including "". Absent is not a guess, which is the
 * rule `planPhase` already follows a few dozen lines below: a pulse that
 * reported no verdict licenses no claim about a slice, and a row with null here
 * renders exactly as the board did before the field existed.
 */
// THE VERDICTS ARE DOMAIN RULES, RE-EXPORTED HERE. `startabilityVerdict` and
// `sliceVerdict` moved to `packages/domain/src/rules/verdict.ts`: a verdict
// answers a question about a Slice, which is a judgement rather than a
// rendering concern, and this file is the view layer.
//
// Re-exported rather than repointed at every call site. The plan's condition is
// that this file holds no COPY, and a re-export is not one — it is the same
// function, named here for the callers that already import it. Changing forty
// imports would make a move look like a rename.
//
// ALIASED, AND THE ALIAS IS LOAD-BEARING. The domain exports TWO different
// functions whose names collide under this rename: `waveVerdict`
// (`rules/verdict.ts`, one string argument, parses the scan's word) and
// `sliceVerdict` (`rules/eligible.ts`, two arguments, decides a verdict from
// readings). This file wants the FIRST. Dropping the alias binds the name to
// the second, and tsc reports it as an arity error rather than as the wrong
// function — which is what it actually is.
import {
  createPulse,
  divisorFor,
  doubleClaimedBranches,
  quietKind,
  quietNeedsPerson,
  quietNote,
  readingLoss,
  rowPhase,
  sliceReadings,
  startabilityVerdict,
  startPulse,
  waveVerdict as sliceVerdict,
  type QuietBranchReadings,
  type QuietKind,
  type RunningPulse,
} from '@plot-pm/domain';
import { clockSystem } from '@plot-pm/domain/adapters';

export { startabilityVerdict, sliceVerdict };
export type { StartabilityVerdict, BriefState } from '@plot-pm/domain';


/**
 * The one SLICE ENTITY, assembled from the pulse where the verdicts already are.
 *
 * The scan emits `plan → wave → branch` with a verdict per slice; this flattens
 * it to one {@link Slice} per `(plan, wave)`, carrying what a slice is asked
 * about — its identity, its branches, its verdict, its ONE section, its
 * completeness — so no consumer has to re-derive any of it from the rows. That
 * re-derivation, at 33 call sites choosing 33 predicates, is the defect
 * `the-wave-is-a-thing-the-board-can-hold` exists to end; this is the single
 * answer they read instead.
 *
 * DERIVED ONCE, HERE, FROM THE SCAN. `verdict` is the scan's own, parsed
 * through the same `sliceVerdict` gate the row uses — never re-computed.
 * `complete` reads the branch states this pulse already carries; `section`
 * follows from `complete`. No host call, no second scan: every field is a
 * reading of `pulse`, which `rowsFromPulse` has already been handed.
 *
 * The plan identity is the DISPLAY name — the basename with its date prefix and
 * `.md` stripped — the exact spelling `rowsFromPulse` writes into a row's
 * `plan`, so a consumer joining a slice to its rows reads one string from both.
 */
/**
 * The slices the payload carries, from the domain's readings.
 *
 * THE JUDGEMENT IS THE DOMAIN'S AND THE SECTION IS THIS FILE'S. `sliceReadings`
 * decides what a slice IS — its branches, its verdict, whether it is complete —
 * and this maps that onto the `Wave` the view groups and renders. A rule that
 * named sections would be deciding where a row is drawn.
 */
export function deriveSlices(pulse: FleetReading): Slice[] {
  return sliceReadings(pulse).map((slice) => ({
    plan: slice.plan,
    name: slice.name,
    branches: [...slice.branches],
    verdict: sliceVerdict(slice.verdict),
    section: (slice.complete ? 'done' : 'not-started') as WaitingGroup,
    complete: slice.complete,
    planSliceCount: slice.planSliceCount,
  }));
}


/**
 * What `plot-dispatch.sh` names the worker's log inside the worktree it made.
 *
 * A SECOND SPELLING OF `worker-log.ts`'s `WORKER_LOG_NAME`, and importing that
 * one instead would be the obvious move. It cannot be done: `worker-log.ts`
 * imports `pulseFor` from THIS module, so the arrow already points that way and
 * reversing it closes a cycle. The name is `plot-dispatch.sh`'s, fixed at the
 * point the worktree is made, and both readers are describing the same shell
 * constant rather than agreeing on a convention of their own.
 *
 * The duplication is therefore declared rather than hidden — `continue.ts:487`
 * already spells it a third time inline. What must not drift is the SHELL,
 * which is the source both sides read.
 */
const WORKER_LOG_FILENAME = '.plot-worker.log';

/**
 * Where to go and look, for the note of a worker that broke.
 *
 * **The log first, the worktree second, and that order is the reader's.** A
 * crashed agent's log is what says WHY; the worktree is where the rest of the
 * evidence sits and where the work is resumed. Naming the directory alone would
 * make the reader guess the filename — and it is a dotfile, so a plain `ls`
 * does not show it.
 *
 * NEITHER PATH IS PROBED, and that is not laziness. Deciding the clause on
 * `existsSync` would make one sentence depend on a disk read taken at scan time
 * and rendered later, so a log rotated between the two would silently drop the
 * only pointer the row had. The clause says *where a log would be*, which is
 * true whether or not the file survived, and `/api/worker-log` is what answers
 * *is there one* — it already reports `no-log` and `no-worktree` as distinct
 * outcomes precisely so that question has one owner. This is Principle 3 in the
 * small: report the location, conclude nothing about it.
 *
 * Returns "" for an absent worktree, which the caller appends as nothing at all.
 *
 * Exported for test: an implementation that names the directory and forgets the
 * log passes every assertion that only greps for the path.
 */
export function whereToLook(localWorktree: string): string {
  if (!localWorktree) return '';
  // `path.join` rather than a template, so a worktree the scan reported with a
  // trailing slash does not produce a doubled separator in a path a person is
  // about to paste into a shell.
  return ` · log: ${path.join(localWorktree, WORKER_LOG_FILENAME)} (worktree ${localWorktree})`;
}

/**
 * What kind of row this branch is — its section and its sentence.
 *
 * The whole of the old `classify`, unchanged, and split out for one reason:
 * `classify` now answers a THIRD thing, and the third answer does not depend on
 * any of the thirty branches below. Threading `verdict` through every `return`
 * would put thirty chances to forget it where there is genuinely one — and a
 * forgotten one fails by leaving the field null, which is indistinguishable
 * from an older scan. Computed once at the single exit instead.
 */
function classifyGroup(
  state: BranchState,
  verdict: string,
  ageMinutes: number | null,
  quietMinutes: number,
  pr?: PrRecord | null,
  /**
   * A local worktree for this branch has uncommitted changes — see
   * `SourceBranchSchema.local_dirty`. Used for exactly one thing, below: to LIFT
   * a branch out of quiet. It may never downgrade an answer, because it is true
   * only on the machine doing the looking, and false is what every branch
   * elsewhere reports.
   */
  localDirty = false,
  /**
   * Commits the local branch has that the remote does not — see
   * `SourceBranchSchema.local_ahead`. Same single use as `localDirty`: it LIFTS a
   * branch out of quiet and may never downgrade an answer, because it is true
   * only on the machine doing the looking and 0 is what every branch elsewhere
   * reports.
   */
  localAhead = 0,
  /**
   * The PLAN's own lifecycle phase, verbatim from `plot-plan-meta.sh` — see
   * `PlanSchema.phase`. Used for exactly one thing, below: to stop a
   * DRAFT plan's branches reading `eligible`.
   *
   * The pulse has carried this since #140, deliberately as data — *"It is
   * reported, never decides"* — and nothing read it. Deciding with it is this
   * layer's job, which is why the condition is here and not in the scan.
   *
   * Defaults to "" so every caller predating the field is unchanged: an unknown
   * phase must answer exactly as before rather than guess that a plan is a
   * draft. Only the literal `draft` narrows an answer; every other value,
   * including "", falls through.
   */
  planPhase = '',
  /**
   * What the scan found out about a worker on this branch — see
   * `SourceBranchSchema.worker`. Six values, and each names a different move.
   *
   * Used to answer the two questions a claim alone cannot: *is anything
   * actually running*, and *did whatever ran end well*. A stopped worker is the
   * one case that moves a row, and it moves it UP: `failed` and `finished` land
   * in `waiting-on-you`, because both need a person and their needs are
   * opposite — restart versus review.
   *
   * `waiting` IS NOT ONE OF THOSE, and its exception is the section boundary
   * rather than a special case. WAITING ON YOU lists results to inspect on the
   * git host; WORKING lists agents. An agent that stopped to ask still holds its
   * worktree and its context, and what unblocks it is an answer — so it stays in
   * `working`, annotated with the question. See the arm.
   *
   * ONE-DIRECTIONAL, like every other local signal here. `none` and `elsewhere`
   * change no group at all: absent is not false, and reading a missing pid as
   * "nobody is working" would report every hand-started worker dead — five in a
   * single session. They narrow the NOTE and nothing else.
   *
   * Defaults to `elsewhere` so every caller predating the field is unchanged:
   * a caller with nothing to say about a worker is a caller that could not look.
   */
  worker: WorkerState = 'elsewhere',
  /**
   * The worker's exit code as the SCAN read it, or "" — see
   * `SourceBranchSchema.worker_exit`. Shown beside `failed` so the row names how
   * the worker died rather than only that it did.
   */
  workerExit = '',
  /**
   * The worker's pid as the SCAN read it, or "" — see
   * `SourceBranchSchema.worker_pid`. Shown beside `running` so the reader can go
   * look at the process rather than take the row's word for it.
   *
   * Never re-derived from here. `kill -0 0` signals the whole process group and
   * succeeds, so a pid of `0` checked on this side reads as running forever; the
   * scan rejects it and reports `none`, and this value only ever renders.
   */
  workerPid = '',
  /**
   * A local worktree for this branch is holding `.git/index.lock` — see
   * `SourceBranchSchema.local_locked`. A write is in progress at this instant,
   * which is the most direct evidence of activity any of these signals carries.
   *
   * Same single use and same one-directional rule as `localDirty` and
   * `localAhead`: it LIFTS a branch out of quiet and may never downgrade an
   * answer, because it is observable only on the machine doing the looking and
   * false is what every branch elsewhere reports.
   *
   * Was last in the parameter list when it was the newest; `workerDirtyPaths`
   * now holds that place, for the same reason and by the same rule.
   */
  localLocked = false,
  /**
   * What a `stalled` worker left uncommitted — see
   * `SourceBranchSchema.worker_dirty_paths`. Named in the note so the row
   * supports the decision it exists for: whether this branch is worth resuming.
   *
   * Empty for every other state, and empty is simply nothing to add — no state
   * changes on account of it.
   *
   * LAST, BECAUSE IT IS THE NEWEST, and that rule is not a style preference
   * here. Inserting it mid-list silently shifted every argument after it, and
   * the spread-tuple callers in the suite fed a `boolean` into this slot and
   * `undefined` into `localLocked` — six tests failed on a lock that had
   * stopped arriving. The compiler did not object, so position is the only
   * thing protecting these callers.
   */
  workerDirtyPaths: readonly string[] = [],
  /**
   * What a `waiting` worker asked — the marker line from its tree, or "" when
   * this machine could not read one. See `workerQuestions`.
   *
   * SAYS WHAT IT WAITS ON, not merely that it waits. *worker is waiting on an
   * answer* names a state and withholds the only part a reader can act on;
   * a row that carries the question lets them answer it, or decide it is not
   * theirs, without opening the worktree first.
   *
   * "" IS A STATED UNKNOWN AND RENDERS AS ONE. The scan already decided the
   * worker is `waiting` — it found a marker — so an empty string here means
   * this read did not find what that one did, never that nothing was asked. The
   * note says *reason unavailable* and the row stays in WORKING. A fabricated
   * question would be the worse failure by far: a reader who answers the wrong
   * question has done work that clears nothing, and unlike a blank they have no
   * signal that they were misled.
   *
   * LAST, BECAUSE IT IS THE NEWEST — the rule `workerDirtyPaths` records above,
   * and for the reason recorded there: inserting a parameter mid-list shifts
   * every spread-tuple caller in the suite silently past the compiler.
   */
  workerQuestion = '',
  /**
   * Whether a local worktree HOLDS this branch — checked out here AND its tip
   * has not merged. See `SourceBranchSchema.held`.
   *
   * THE ONLY SIGNAL THAT SAYS *HELD* rather than merely *touched*, and the
   * distinction the no-ref arm below needs. A branch can be ahead with no
   * worktree — a leftover local ref nobody is on — and a worktree can be clean
   * while holding commits, which is an agent that committed and kept working.
   * Neither fact alone separates *someone is on this* from *nobody is*. A held
   * worktree does, because a worktree exists on purpose and `held` is the one
   * that has already excluded the merged leftover.
   *
   * THE AUTHORITATIVE FORM OF `local_worktree`, and the reason this branch
   * exists. #258 lifted a branch out of NOT STARTED by reading the worktree PATH
   * (`local_worktree !== ''`) directly, which also fires on a CLEAN worktree
   * left on a branch whose work has landed — a leftover directory, not somebody
   * working. That is the merged-leftover misread the plan forbids, and it is
   * visible on exactly one branch: a squash-merged-and-deleted branch reads
   * `open` (its ref is gone, so the merge is invisible to a plain ancestry
   * walk), and a worktree left on it must not read WORKING. The scan excludes
   * `merged` before it sets this, so the consumer reads one boolean here instead
   * of re-deriving `!merged` from the path. The PATH still travels to the row —
   * it is what the plan modal names — but only via the pulse's `worktrees` list,
   * never through this function, which decides the lift and nothing else.
   *
   * Same one-directional rule as `localDirty`, `localAhead` and `localLocked`:
   * it may only LIFT a branch out of quiet, and it is false on every machine
   * that holds no worktree for the branch — so the claim ref stays primary and a
   * branch worked on another host answers from its ref exactly as before.
   *
   * LAST, BECAUSE IT IS THE NEWEST — the rule `workerQuestion` and
   * `workerDirtyPaths` record above, and for the reason recorded there:
   * inserting a parameter mid-list shifts every spread-tuple caller in the suite
   * silently past the compiler. Defaults to false so every caller predating the
   * field is unchanged: absent and "nothing here holds it" are the same
   * statement.
   */
  held = false,
  /**
   * Where this branch is checked out on THIS machine, or "" — see
   * `SourceBranchSchema.local_worktree`. Named in the note of a BROKEN worker
   * (`failed`, `ended`, `stalled`) and read for nothing else.
   *
   * THE PATH, HERE, AFTER `held` DELIBERATELY DID NOT TAKE IT. `held` is the
   * authoritative form of `local_worktree` *for the WORKING lift* — a boolean,
   * because a lift needs a yes, and a path would invite deciding on the path's
   * mere presence, which is the merged-leftover misread `held` exists to
   * prevent. That argument is about DECIDING, and this parameter decides
   * nothing: it lands in a sentence a person reads. So both are right and both
   * are here — `held` for the lift, this for the errand — and neither derives
   * from the other, since a merged leftover has a path and earns no lift, while
   * a branch held on another machine has no path here at all.
   *
   * A BROKEN AGENT IS THE ONE ROW THAT NEEDS IT. Every other section either
   * says what it means without a place (a PR is on the host, a slice is in a
   * plan) or is not a row anyone opens a directory about. A reader told an
   * agent crashed and not told where its log is has been informed, not helped —
   * they must go find the worktree themselves, which is the work the row
   * existed to save them.
   *
   * "" IS A STATED ABSENCE AND THE NOTE OMITS THE CLAUSE, never guessing a
   * path. The path is true on this machine and meaningless on any other, so a
   * reader elsewhere gets the evidence and no location — honest, where a
   * reconstructed path would name a directory that does not exist where they
   * are reading.
   *
   * The note above this line had `LAST, BECAUSE IT IS THE NEWEST`; see
   * `prUnknown` below for the current last.
   */
  localWorktree = '',
  /**
   * Whether this branch's PR could not be read from the origin — see
   * `PR_UNKNOWN_NOTE`. When true and the slice verdict would otherwise be
   * `eligible`, the verdict is WITHHELD: the row says the host could not be
   * asked rather than claiming the branch is ready for an agent.
   *
   * Withholds the VERDICT, not the row. A branch with an unknown PR still
   * names its slice, plan, and branch, and still reads `merged` where git says
   * merged. Only the verdict — the claim that an agent may take it — is what
   * the host's answer supplies, and only that part is withheld.
   *
   * Host-agnostic by design. The same rule applies whether the origin is
   * GitHub, Bitbucket, or any backend added later: an origin that could not
   * be asked propagates as a gap, never as a value a verdict can be computed
   * from. See `PR_UNKNOWN_NOTE` for the statement that backends inherit.
   *
   * LAST, BECAUSE IT IS THE NEWEST — the rule `localWorktree`, `held`,
   * `workerQuestion` and `workerDirtyPaths` each record above, and for the
   * reason recorded there: inserting a parameter mid-list shifts every
   * spread-tuple caller in the suite silently past the compiler, and this
   * file has paid that once already.
   */
  prUnknown = false,
  /**
   * Why a `deferred` branch was given up — `SourceBranchSchema.deferred_reason`,
   * the text of the plan's `deferred:` annotation.
   *
   * LAST, BECAUSE IT IS THE NEWEST, by the rule `prUnknown` records above.
   *
   * It answers a question `planPhase` cannot. A withdrawn plan keeps
   * `Phase: Draft` deliberately — Plot has four phases and none of them is
   * *withdrawn*, and `the-board-answers-while-it-scans` says so in its own
   * text: *"the phase stays Draft because inventing a fifth"* is worse. So the
   * phase reads `draft`, the row says *plan not approved yet — still in
   * review*, and the reader is told a decision is pending that was already
   * made. Measured on the live board 2026-09-02, on that plan's own row.
   */
  deferredReason = '',
  /**
   * Whether the host merged ANY PR from this branch — the any-state answer,
   * not the open one.
   *
   * LAST, BECAUSE IT IS THE NEWEST, by the rule `prUnknown` records above.
   *
   * `wipReadings` hardcoded `hasMergedPr: false`, so `quietKind`'s first guard
   * could never fire and every merged branch fell through to `abandoned`.
   * Squash-merge is why it matters: the head ref is deleted on merge, so the
   * branch has no OPEN PR and reads *"commits, no PR ever opened"* — which is
   * false, and put ~15 branches merged the same evening into WAITING ON YOU.
   * Measured 2026-09-04: that section held 35 rows, of which 3 were work
   * anyone was waiting on.
   *
   * The same trap `plot-pr-merged.sh` exists for: a merged PR reports `CLOSED`,
   * and an absent head ref reports nothing at all.
   */
  hasMergedPr = false,
): { group: WaitingGroup; note: string } {
  // A deferred branch is never `working` — the group is about the claim the row
  // makes, not about the age of its last commit, so a fresh commit does not
  // pull it in. Work somebody gave up is not work in progress.
  //
  // WHICH section it lands in is decided inside, and by the plan's phase before
  // anything else. See there.
  if (state === 'deferred') {
    // THE PHASE ANSWERS FIRST HERE TOO, and that is the whole of slice 2.
    //
    // #231 put the phase check at the top of the `open` arm below, and it
    // worked for every row that reached NOT STARTED through it. Deferred rows
    // reach the same section through THIS arm, above that one, and so never met
    // the guard. Measured on the live board 2026-08-18, minutes after #231
    // merged: three deferred rows still in NOT STARTED, one of them
    // `feature/plot-sprint-support` — a plan Released in v1.0.0-beta.3, four
    // months earlier, whose branch was never created because February's work
    // landed directly on main.
    //
    // Two routes into one section, and a rule guarding one of them is not the
    // rule. So the section's question is asked of the plan before it is asked of
    // the shelf, whichever route brought the row here.
    //
    // ONLY THE TERMINAL PHASES, and the narrowing stops exactly there — this
    // does not replace the `'you'` answer below, it bounds it. A deferred branch
    // of an APPROVED plan genuinely waits on a person: somebody shelved it,
    // somebody may un-shelve it, and `waitingOnFor` still colours it `you`. A
    // deferred branch of a RELEASED plan waits on nobody — the plan shipped and
    // the shelf is part of its history. A `draft` branch is not finished either,
    // but it does not stay in this section: it leaves for WAITING ON YOU on the
    // line below, the same answer the `open` arm gives a draft branch, because
    // the act it waits on is the plan's approval and that lives on the plan head.
    //
    // ABOVE the three exits below rather than beside one of them. A shelved
    // branch of a shipped plan is finished whether it was shelved with no
    // commits, after a commit, or with a PR still open — those distinctions
    // refine what a LIVE plan's shelf says, and a finished plan has nothing for
    // them to refine.
    if (planPhase === 'delivered' || planPhase === 'released') {
      return { group: 'done', note: FINISHED_PLAN_NOTE };
    }
    // A DRAFT plan's shelved branch waits on a person, and it belongs in WAITING
    // ON YOU — the same answer, and the same note, the `open` arm gives a draft
    // branch a few dozen lines below. It USED to fall through to `not-started`,
    // because `'draft'` sat in the allowlist below beside `''`; that put an
    // unapproved plan's branch in the section whose hint reads *approved —
    // nobody has taken it*, offering work no phase gate would let an agent take.
    //
    // The wait it once described — approve the plan, un-shelve the branch — is
    // real, but it is one wait on one person for one next act: the approval. So
    // it goes where the approval lives, beside the plan head that now carries
    // the act, rather than pretending to be startable in NOT STARTED.
    //
    // Above the allowlist and stated as its own inclusion, exactly as the `open`
    // arm states it, so the two arms answer a draft branch the same way and
    // neither has to remember to exclude it from a list meant for phases the
    // board cannot read.
    if (planPhase === 'draft') {
      // THE ANNOTATION OUTRANKS THE PHASE, and only in this arm. A deferred
      // branch carries a reason somebody wrote; a draft phase is the absence of
      // an approval. Where both are present the written one is the specific
      // answer, and `DRAFT_PLAN_NOTE` is the generic one — so it is the
      // fallback, never the override.
      //
      // AND THE GROUP MOVES WITH IT, which the first version of this arm got
      // wrong. It changed the sentence and kept `waiting-on-you`, calling that
      // conservative — but the group is the half that asks a person for
      // something, so the row went on requesting a decision while its own note
      // said the decision had been made. `the-board-answers-while-it-scans` sat
      // in WAITING ON YOU for a day after its withdrawal was rendered
      // correctly, measured 2026-09-03.
      //
      // A DEFERRED BRANCH OF A DRAFT PLAN WAITS ON NOBODY WHEN A REASON IS
      // WRITTEN. Somebody already decided and wrote down why; the row is a
      // record, and QUIET is where records of work nobody is coming back for
      // belong. With NO reason the phase sentence still stands and so does the
      // placement: an unapproved plan's shelved branch genuinely waits on the
      // approval, which is #231's measurement and is untouched here.
      if (deferredReason !== '') {
        return { group: 'quiet', note: deferredReason };
      }
      return { group: 'waiting-on-you', note: DRAFT_PLAN_NOTE };
    }
    // The allowlist, as in the `open` arm and for its reason: a phase the board
    // has not been taught is not startable, and the sentence NAMES it rather
    // than inventing a placement. `''` falls through untouched — a scan
    // predating the field says nothing about the plan, and absent is not a
    // guess. `feature/the-pulse-repairs-the-artifact` rendered `plan phase:
    // NONE` in the same measurement, its plan unresolvable from the branch name;
    // filing that under DONE would be the same guess in the other direction.
    //
    // `'draft'` is NO LONGER excepted here — it answers above, on its own line,
    // rather than by being kept off this list. A plan under review is not a
    // phase the board fails to recognise, and treating it as one is how the two
    // arms came to disagree about where its shelved branch belongs.
    //
    // No worktree check sits between this and the terminal arm above, unlike in
    // the `open` arm where one deliberately does. There is nothing here for it
    // to protect: a deferred row never reads `working`, because the group is
    // about the claim the row makes and shelved work is not work in progress.
    if (planPhase !== '' && planPhase !== 'approved') {
      return { group: 'done', note: unknownPhaseNote(planPhase) };
    }
    // BELOW THE PHASE, THE SHELF STILL SPEAKS — and the note is not the word
    // `deferred`. That was the old answer and it displaced whatever else the row
    // had to say: a branch started and then shelved read as never begun, with
    // its age and its PR erased. The fact is carried by `state`, beside the note
    // rather than instead of it — the same shape as the `no story` badge on a
    // plan card. Mark the thing; do not bend the state to encode it.
    if (pr) return { group: 'not-started', note: withNote(`PR #${pr.number}`, reviewNote(pr)) };
    if (ageMinutes === null) return { group: 'not-started', note: 'no commits' };
    return { group: 'not-started', note: `last commit ${humanAge(ageMinutes)} ago` };
  }

  // A PR outranks the git state for work in flight: once a branch has one,
  // what it waits for is decided there, not by commit age. Merged and
  // not-yet-pushed branches keep their git answer.
  //
  // A DRAFT IS STILL THE AUTHOR'S — A READY PR IS NOT.
  //
  // A running worker skips this arm only where the PR is a draft. The 2026-08-17
  // fix that also skipped green and pending PRs was scoped one notch too wide —
  // that defect was an agent whose DRAFT PR went green, still the author's,
  // still WORKING. Three ready green PRs (#389/#390/#391) then sat reviewable
  // and invisible because they were treated as "asking nobody".
  //
  // The partition that matters is draft versus ready, not green versus failing:
  // a draft says "I am not finished", a ready PR says "I am finished and need
  // review". So a running worker keeps its branch row only while the PR is a
  // draft, and loses it the moment the PR is marked ready.
  if (pr && state !== 'merged' && state !== 'open' && !(worker === 'running' && prAsksNobody(pr))) {
    const note = reviewNote(pr);
    // THE CONFLICT OUTRANKS THE CHECKS, and it has to be said before the switch
    // rather than inside it, because the value it corrects is `none`.
    //
    // GitHub starts no workflow for a branch that does not merge, so a
    // conflicting PR reports an EMPTY rollup and falls into the `none` arm
    // below — where the note reads *no checks*, which is true and useless: it
    // names the symptom and withholds the cause, and the two situations that
    // share those three words want opposite things. `no checks` on a bot PR
    // wants a click; on this one it wants a rebase.
    //
    // `waiting-on-you` either way, and that moves nothing: a conflicting PR
    // reports an EMPTY rollup, so every row this arm now answers was already
    // landing in `waiting-on-you` through the `none` case below. Only the
    // SENTENCE changes.
    //
    // Drafts included, and deliberately. The `green` arm below defers a draft
    // to its author, but `none` never did — a draft with no checks has always
    // been the author's errand — and a conflict is the strongest possible
    // version of that errand. Adding a draft exemption here would move rows
    // this change is not about, in the direction of saying less.
    // NO `CLOSED` ARM HERE, and the reason is one screen up: *"A merged or
    // declined PR must NOT reach `classify` by head: it would answer for a
    // branch whose git state has already answered."* The `byHead` map is
    // open-only, so a closed PR never arrives — an arm for it would be dead code.
    // I wrote one on 2026-08-21 before reading that line; `prState` is where the
    // closed case belongs, and it is handled there.
    if (pr.mergeable === 'conflicting') {
      return { group: 'waiting-on-you', note: withNote(`PR #${pr.number}, conflicts`, note) };
    }
    // UNKNOWN MERGEABILITY, AND THE NOTE SAYS WHICH FACT IS MISSING.
    //
    // Below `conflicting` and above the `checks` switch, mirroring `prState` —
    // the row's word and its sentence must not be able to disagree.
    //
    // *cannot say whether it merges* rather than *checks unavailable*, because
    // the two are not equally actionable and one label for both is the pattern
    // this repo has spent the day removing: a missing `mergeable` sends a reader
    // to check for a rebase, a missing `checks` sends them nowhere but back
    // later. The checks may well be fine on this row — reporting them as
    // unavailable would be a second false statement layered on the first.
    //
    // `!== 'mergeable'` rather than `=== 'unknown'`, matching `prState` exactly:
    // the row's word and its sentence are derived separately and must agree on
    // every input, including an adapter that omitted the field.
    if (pr.mergeable !== 'mergeable') {
      return {
        group: 'waiting-on-you',
        note: withNote(`PR #${pr.number}, cannot say whether it merges`, note),
      };
    }
    switch (pr.checks) {
      case 'pending':
        return { group: 'waiting-on-machine', note: withNote(`PR #${pr.number}, CI running`, note) };
      case 'failing':
        return { group: 'waiting-on-you', note: withNote(`PR #${pr.number}, checks failing`, note) };
      case 'none':
        // Not green and not running: GitHub starts no workflow for a bot PR
        // until a person approves the run. Saying why beats implying green.
        return { group: 'waiting-on-you', note: withNote(`PR #${pr.number}, no checks`, note) };
      case 'unknown':
        // The host cannot report checks (Bitbucket). Unavailable, not green.
        //
        // *cannot read the checks*, paired with *cannot say whether it merges*
        // above so the two absences are distinguishable in the sentence. This
        // one is the less actionable of the pair: nothing to do yet, look again.
        return { group: 'waiting-on-you', note: withNote(`PR #${pr.number}, cannot read the checks`, note) };
      case 'green':
        if (pr.draft) break; // a draft is still the author's, not yours
        return { group: 'waiting-on-you', note: withNote(`PR #${pr.number} green`, note) };
    }
  }
  if (state === 'open') {
    // A FINISHED PLAN OUTRANKS EVERYTHING THIS ARM COULD SAY, INCLUDING A LIVE
    // WORKTREE.
    //
    // Measured 2026-08-18, minutes after the NOT STARTED case this branch is
    // named for, and it is the same defect mirrored into WORKING:
    //
    //     WORKING (2)
    //       Released  not-yet-asked-is-not-not…  uncommitted work in a local worktree
    //       Released  one-place-for-what-a-ro…   uncommitted work in a local worktree
    //
    // Both PRs (#220, #224) merged and shipped in v2.5.2. Both workers were
    // DEAD. What the board read as *someone is working here* was leftover
    // scratch files — `agentlist_temp.tsx`, `.fleet_part1.js` — written after
    // the push and never cleaned up.
    //
    // So the rule is not "the phase decides NOT STARTED"; it is that the phase
    // answers FIRST in every section, and the local facts refine within it.
    // Each section asks *what would move this forward*, and for a finished plan
    // the answer is *nothing* — it is done. **Local debris is not work.**
    //
    // ONLY THE TERMINAL PHASES sit here. `draft` and an unrecognised phase stay
    // below the worktree check, because neither can honestly claim that nothing
    // would move the row: a plan under review whose branch is being edited has
    // someone working on it, and a phase the board cannot read is not evidence
    // of anything. Only `delivered` and `released` mean *finished*, and only
    // *finished* outranks the sight of somebody typing.
    if (planPhase === 'delivered' || planPhase === 'released') {
      // The work is done; no branch of it can be waiting for an agent or hold
      // one working. The note accounts for the missing ref rather than leaving
      // a DONE row unexplained — `plot-sprint-support` has no branch because
      // the change went straight onto main.
      return { group: 'done', note: FINISHED_PLAN_NOTE };
    }
    // WORK IN A LOCAL WORKTREE OUTRANKS "nobody has started this".
    //
    // `open` means git has no ref for the branch — which is what a branch that
    // was never created looks like, AND what a branch created only locally
    // looks like. The second is somebody working, and the scan can tell: it
    // reports `local_dirty` / `local_locked` from the worktree.
    //
    // Without this the row said *eligible — nobody has taken it* while carrying
    // the activity mark that means *someone is writing here*. One row, two
    // statements, and they contradict each other — measured 2026-08-17 on a
    // branch being edited at that moment.
    //
    // `local_ahead` WAS deliberately not part of this, on the reasoning that
    // unpushed commits are finished work sitting still and earn the unpushed
    // mark rather than a claim that someone is at the keyboard — the split
    // `isActive` makes on the client. That reasoning survives everywhere a
    // branch has a ref, and it was wrong here, where none does. See the note
    // at the condition itself.
    //
    // Ordered ABOVE the slice verdict on purpose: someone editing a branch of a
    // blocked slice is still someone editing. The board reports what is, not
    // what the ordering says should be. A DRAFT plan keeps that too — a plan
    // under review whose branch is being edited has someone working on it; the
    // review is what is outstanding, not the work.
    //
    // And BELOW the terminal-phase check above, which is the one thing that
    // outranks it. See there for the measurement: a shipped plan's leftover
    // scratch files are not somebody working.
    //
    // UNPUSHED COMMITS COUNT **HERE**, and only here. The paragraph above is
    // right about a branch that HAS a ref: unpushed commits there are finished
    // work sitting still, and they earn the unpushed mark rather than a claim
    // that someone is at the keyboard. This arm is the other case — `open`
    // means git has no ref for the branch at all — and there the same fact
    // means something else entirely: commits nobody else can see are the ONLY
    // evidence the branch exists. A worktree holding them is held.
    //
    // Measured 2026-08-20, three worktrees with one commit each and clean
    // trees: the board printed `WORKING: none — nothing to do, just look` and
    // offered all three as *eligible — nobody has taken it*, which is an
    // invitation to put a second agent on finished work. `local_ahead` was
    // read, plumbed to this line, and then discarded for a hardcoded 0.
    //
    // THE LIFT READS `held`, NOT THE RAW PATH. #258 keyed this on the worktree
    // PATH (`local_worktree !== ''`), which also fires on a clean worktree left
    // on a squash-merged-and-deleted branch — that branch reads `open` because
    // its ref is gone, so the merge is invisible here, and the leftover
    // directory read as *somebody working*. `held` is the path AND an unmerged
    // tip, the AND the scan already computed; reading it keeps a merged leftover
    // in NOT STARTED where it belongs. The path itself does not reach this
    // function — the row NAMES it through the pulse's `worktrees` list.
    //
    // WORKING IS ABOUT AGENTS. Agentless local activity goes to NOT STARTED
    // — the branch is eligible for dispatch but nobody has taken it yet. The
    // section means *an agent is working on this*, not *local activity
    // observed*. See `every-section-has-one-subject`, slice Inverted.
    if (localDirty || localLocked || held) {
      return localActivity(localDirty, localAhead, localLocked, held);
    }
    // THE PLAN'S PHASE IS ASKED FIRST, AND IT DECIDES THE SECTION.
    //
    // NOT STARTED means *an agent may take this*, and only one phase means
    // that. `Approved` is precisely *decided, not yet done* — the phase in
    // which `/plot-dispatch` hands a branch to an agent, and the only one.
    // Every other phase fails the section's own question:
    //
    //     Draft      no — waits on approval        WAITING ON YOU
    //     Approved   YES                           NOT STARTED
    //     Delivered  no — the work is done         DONE
    //     Released   no — shipped                  DONE
    //
    // This is not a rule layered on top of the phase model; it IS the phase
    // model, which is why it reads as one inclusion rather than three
    // exclusions.
    //
    // The board grouped by BRANCH STATE and never asked, and that one omission
    // explains every symptom at once: a branch with no ref reads as "never
    // started", which is true of a branch nobody created and equally true of
    // one deleted at merge four months ago. Measured here 2026-08-18 —
    // ten plans in NOT STARTED, three Approved, seven Draft that
    // `/plot-dispatch` refuses, and `plot-sprint-support`, Released since
    // v1.0.0-beta.3. A later hygiene sweep set 39 delivered plans to `Released`
    // and the section grew to twenty rows, ten of them shipped work offered as
    // available. The sweep multiplied the defect rather than causing it.
    //
    // ORDERED IN TWO HALVES, and the split is by whether the phase can honestly
    // say *nothing would move this forward*.
    //
    // The TERMINAL phases answer at the top of this arm, above even the local
    // worktree check — see there for the measurement that put them there.
    //
    // `draft` and an unrecognised phase answer HERE, below it: a plan under
    // review whose branch is being edited has someone working on it, and a
    // phase the board cannot read is not evidence of anything. Both still sit
    // ABOVE the slice verdict, because a slice's ordering is a question about an
    // approved plan and neither of these is one — the verdict refines the
    // answer WITHIN `approved`, which is exactly the scope it keeps below.
    //
    // AN ALLOWLIST, like `prAsksNobody` and for its reason: a blocklist of
    // finished phases would silently start claiming "an agent may take this"
    // the first time a phase is added, which is the direction that goes quiet
    // rather than loud.
    //
    // "" IS NOT A PHASE AND MUST NOT BE TREATED AS ONE. A pulse from a scan
    // predating the field says nothing about the plan, and absent is not a
    // guess — reading it as unstartable would empty the section wholesale
    // against an older scan. It falls through to the git answer, exactly as
    // before.
    if (planPhase === 'draft') {
      // A person, and the note names WHICH action — the reader's next question
      // is *waiting on what*, and here the answer is a review rather than
      // another branch. It also says what would unblock the row.
      //
      // BELOW the worktree check, unlike the terminal phases above. Draft is
      // not finished: a plan under review whose branch is being edited right
      // now has someone working on it, and only a terminal phase can say
      // *nothing would move this forward*.
      return { group: 'waiting-on-you', note: DRAFT_PLAN_NOTE };
    }
    if (planPhase !== '' && planPhase !== 'approved') {
      // A phase the board has not been taught. Not startable — see the
      // allowlist note above — and the sentence says the board cannot place it
      // rather than inventing a reason it cannot know.
      //
      // Below the worktree check with `draft`, and for the same reason: an
      // unrecognised phase may not be a finished one, so it must not silently
      // claim that live editing is debris.
      return { group: 'done', note: unknownPhaseNote(planPhase) };
    }
    // An earlier slice keeps the first word, WITHIN an approved plan. That scope
    // is what the phase check above establishes: every row reaching here is one
    // an agent may actually take, so the slice verdict is now the only thing
    // left to refine.
    //
    // THE BLOCKED CASE IS NAMED, not inferred from everything-but-eligible.
    // This read `verdict !== 'eligible'`, which sent three inputs to one
    // sentence: `blocked` (true), `complete` (FALSE — a finished slice blocks
    // nobody), and an unrecognised or absent verdict (unknowable). The middle
    // one is the defect the plan measured, and it is the same blocklist-collapse
    // shape as the blocker search above — an allowlist of one good value, so
    // every other input inherits the bad answer.
    if (verdict === 'blocked') return { group: 'not-started', note: BLOCKED_NOTE };
    // AN UNKNOWN PR WITHHOLDS THE VERDICT, NOT THE ROW.
    //
    // The slice verdict from the scan says `eligible`, but the host could not
    // answer — a spent quota, an unreachable server, a backend the board
    // cannot ask. The row may not claim readiness from a gap: `eligible` is
    // an answer about the host, and the host did not answer.
    //
    // `waiting-on-you` RATHER THAN `not-started`, because the errand is
    // explicitly about the reader: check your connection, wait for the quota
    // to reset, look at the banner that names the outage. It is the same
    // section an unreadable `mergeable` field goes to, for the same reason.
    //
    // EVERYTHING ELSE STAYS. Git answered, and the branch still carries its
    // slice, its plan, its git state. Only the PR-derived verdict is withheld;
    // Done-when 4 is the assertion that a naive fix does not blank the row.
    if (prUnknown && verdict === 'eligible') {
      return { group: 'waiting-on-you', note: PR_UNKNOWN_NOTE };
    }
    if (verdict === 'eligible') return { group: 'not-started', note: ELIGIBLE_NOTE };
    // `complete` AND EVERY UNRECOGNISED VERDICT, INCLUDING "", and the answer is
    // deliberately the OLD sentence rather than a new one.
    //
    // An `open` branch of a `complete` slice is a contradiction: the scan counts
    // an `open` branch as outstanding, so a slice holding one cannot be
    // complete. So this arm is unreachable from a scan that agrees with itself,
    // and the row it would build is one nobody has ever seen — which is exactly
    // why it may not invent a sentence. `BLOCKED_NOTE` says *blocked by an
    // earlier slice*: not startable, ordering not satisfied, no claim about
    // WHICH slice. That is the honest reading of a verdict this board cannot
    // place, and it is what every such row already said.
    //
    // What changed is that the reasoning is now recorded at the arm instead of
    // being a side effect of the predicate. The row's `verdict` field says
    // which case actually arrived — `complete`, or null for the unrecognised —
    // so a consumer no longer has to infer it from a sentence shared by three
    // inputs. The prose is the fallback; the field is the fact.
    return { group: 'not-started', note: BLOCKED_NOTE };
  }
  // A WORKER'S OWN STATE outranks the commit clock, whatever that clock says.
  //
  // The arm used to be titled *a worker that stopped is a person's errand*, and
  // it now holds two that are not. `running` moved in when a live agent was
  // being pulled out of WORKING by its own first commit; `waiting` moved in
  // when a stopped-to-ask agent was being filed as a result. Both are agents
  // holding a branch, and they answer FIRST, above the three that need a person.
  //
  // Placed after the PR arm and before the git arms on purpose. A PR is a
  // stronger statement about what a branch waits for — the review is happening
  // whether or not the worktree still has a process in it — but everything
  // below here is reasoning from commit AGE, and age cannot see a worker at all.
  // A crashed worker three minutes into a claim is `working` by age and needs
  // restarting in fact.
  //
  // `merged` and `open` are left alone: a merged branch is done regardless of
  // what its worktree holds, and an `open` branch was never claimed, so a stale
  // worktree from an earlier attempt must not speak for it. `open` has already
  // returned above, so only `merged` needs excluding here.
  //
  // THE FOUR STOPPED STATES SPLIT TWO WAYS, and the split is what earns them
  // separate values. `failed` and `finished` both go to `waiting-on-you` because
  // both need a person — but the notes stay apart because the ACTIONS are
  // opposite: restart a crash, review a success. One label over both would send
  // the reader to a log to find out which, which is the same defect this whole
  // change exists to remove. `ended` joins them saying exactly what it knows:
  // it stopped, and the status was not recorded.
  if (state !== 'merged') {
    // A RUNNING WORKER PUTS THE ROW IN WORKING, WHATEVER ELSE IS TRUE OF IT.
    //
    // This used to sit inside the `state === 'claimed'` arm below, and the
    // effect was that an agent LOST its place in WORKING at the moment it
    // proved it was working: the first real commit takes a branch out of
    // `claimed` and into `wip`, and opening a PR sends it to `waiting-on-you`
    // from the PR arm 120 lines above — before anything asks about a worker.
    //
    // Measured on 2026-08-17: two agents ran for a quarter of an hour with
    // WORKING empty, while WAITING ON YOU showed their branches. Both sections
    // were lying in opposite directions.
    //
    // Placed here, beside the other three worker verdicts, because the whole
    // point of this arm is that a worker's own state outranks reasoning from
    // commit age — and `running` is the strongest evidence of the four. The
    // three below say a person is needed; this one says nobody is.
    //
    // `merged` still excludes itself, by the arm's own condition: a branch that
    // landed is done regardless of what its worktree still holds.
    //
    // The PR arm above is now the ONE thing that can still outrank a live
    // worker, and deliberately: a PR with conflicts or failing checks is a
    // person's errand even while an agent is mid-run. That is a narrower claim
    // than the old ordering made, and it is the one this change keeps.
    if (worker === 'running') {
      return { group: 'working', note: `worker running (pid ${workerPid})` };
    }
    // A WAITING WORKER IS STILL A WORKER, AND WORKING IS WHERE IT BELONGS.
    //
    // It sat in `waiting-on-you` until now, below `finished`, and the effect was
    // that an agent left the section answering *who is working?* at the moment
    // it stopped to ask something. An operator counting agents in WORKING
    // undercounted every one that had a question outstanding — and the row
    // arrived in WAITING ON YOU carrying none of what that section is built to
    // show: no PR to open, no checks to read, nothing to inspect on the host.
    //
    // THE TWO SECTIONS ANSWER DIFFERENT QUESTIONS, and that is the whole rule.
    // WAITING ON YOU is for RESULTS — branches, PRs, CI, failures, things a
    // person inspects and decides about on the git host. WORKING is for AGENTS.
    // An agent that has stopped to ask is still mid-run: its worktree is live,
    // its context is intact, and what unblocks it is an ANSWER rather than a
    // review. Filing it under the other verb is what made one incident's row
    // read *worker finished — review it* over two local commits and a question.
    //
    // PLACED WITH `running` RATHER THAN WITH THE STOPPED STATES, and the comment
    // above `running` is the precedent: a worker's own state outranks reasoning
    // from commit age, and these two are the pair that say an agent still holds
    // the branch. The three below say a person is needed.
    //
    // STILL ABOVE `stalled`, which is the ordering guarantee this arm has
    // carried since the state shipped, and moving the arm must not cost it. A
    // marker is the worker saying *your turn*, and a worker that asked a
    // question has almost always left the work it was doing uncommitted beside
    // the question — so ranking dirtiness first files every such branch under
    // *resume it* and invites a restart into the same wait. Measured happening
    // twice to one branch, the second restart re-running work the first had
    // finished. `stalled` is now further down than it was, which strengthens
    // that guarantee rather than weakening it.
    //
    // THE PR ARM 120 LINES ABOVE STILL OUTRANKS THIS, deliberately and
    // unchanged: a PR with conflicts or failing checks is a person's errand even
    // while an agent waits. `running` is exempted from that arm where the PR
    // asks nobody anything; `waiting` is NOT given the same exemption, because
    // the exemption exists for an agent that opened a PR and kept working, and
    // an agent that has stopped is not that.
    if (worker === 'waiting') {
      // NAME THE QUESTION. The row exists so a reader can answer it, and *what
      // is it waiting on* is the question the old sentence provoked and did not
      // answer — the reader had to open the worktree to learn whether it was
      // theirs to answer at all.
      //
      // AN UNREADABLE MARKER IS A STATED UNKNOWN, NEVER A GUESS. The scan found
      // a marker (that is what made this `waiting`); an empty string here means
      // this read did not. Saying so sends the reader to the tree, which is
      // where the answer is. Inventing a plausible question would send them to
      // answer the wrong one, with nothing to signal the substitution.
      return {
        group: 'working',
        note: workerQuestion
          ? `worker waiting on you: ${workerQuestion}`
          : 'worker waiting on you — reason unavailable, look in its worktree',
      };
    }
    // A BROKEN AGENT IS THE ONE AGENT THIS SECTION HOLDS, and the three arms
    // below are it: `failed`, `ended`, `stalled`. WAITING ON YOU is for what
    // needs a person's DECISION, so its normal population is a PR, a branch, a
    // plan, a release. An agent has no business here while it works — an agent
    // IS the worker — and `running` and `waiting` are already gone above, into
    // WORKING where they belong.
    //
    // So the presence of an agent here is ITSELF the signal, which is the
    // property the exception is worth having and the reason it must stay rare.
    // Rarity is a property of the RULE: only a problem state admits an agent,
    // and the arms above are what keep a working one out.
    //
    // THE NOTES SAY WHAT WAS OBSERVED, NEVER WHAT TO DO. They read *restart it*
    // and *resume it* until now, and both were verdicts about the schedule — a
    // conclusion the row is not entitled to. Whether a crashed agent is worth
    // restarting depends on what its log says and on what else is in flight,
    // neither of which this function can see; and the board restarts nothing
    // in any case, since relaunching is `/plot-dispatch`'s to do. Evidence is
    // the estate's rule for exactly this reason — scripts collect, humans
    // conclude (Manifesto Principle 3), the same discipline `HOST_ANSWER_HINT`
    // and the changed-files modal already follow.
    //
    // AND EACH NAMES WHERE TO LOOK. A reader told an agent crashed and not told
    // where its log is has been informed, not helped: they still have to find
    // the worktree, which is the errand the row existed to save them. See
    // `whereToLook` for why the path is never probed first.
    if (worker === 'failed') {
      // THE EXIT CODE IS THE OBSERVATION, and it is what separates this arm
      // from `stalled` below — a non-zero status is the process saying it died,
      // which no amount of work left on the floor can tell you. Kept in the
      // sentence for the same reason it is kept in the enum: `failed` and
      // `finished` are opposite actions, and the number is the evidence for
      // which one arrived.
      return {
        group: 'waiting-on-you',
        note: workerExit
          ? `worker crashed — exited ${workerExit}${whereToLook(localWorktree)}`
          : `worker crashed${whereToLook(localWorktree)}`,
      };
    }
    if (worker === 'finished') {
      return { group: 'waiting-on-you', note: 'worker finished — review it' };
    }
    // `waiting` is handled ABOVE, beside `running` — it is an agent still
    // holding the branch rather than a result for a person, and it keeps its
    // place in WORKING. It stays ranked above this arm, which is the ordering
    // guarantee the scan draws too; see there for the restart-into-the-wait
    // measurement that earned it.
    //
    // A person's errand, and a different one from a question: nothing is being asked, work
    // is simply on the floor with no PR over it. The board REPORTS it and
    // restarts nothing — relaunching is `/plot-dispatch`'s to do, and this row
    // exists so a person can decide to.
    if (worker === 'stalled') {
      // NAME WHAT IS ON THE FLOOR. The row exists so a reader can decide
      // whether to resume the branch, and the files are what that decision is
      // made on — a bare count reads the same for three scratch notes and
      // three half-finished modules. Capped at three names so one branch mid-
      // refactor cannot push every other row off the screen, and the remainder
      // is COUNTED rather than dropped: a silent truncation reads as "that is
      // all of it".
      const shown = workerDirtyPaths.slice(0, 3).join(', ');
      const rest = workerDirtyPaths.length - 3;
      const what = shown
        ? ` (${shown}${rest > 0 ? ` +${rest} more` : ''})`
        : '';
      // *STOPPED WITHOUT FINISHING* AND *CRASHED* ARE DIFFERENT SENTENCES, and
      // the reader does different things with them — which is the whole reason
      // this arm and `failed` are not one label. This worker EXITED 0: the
      // process ended normally and the tree says the task did not end with it,
      // which is why `stalled` is a TASK state rather than a process one. So
      // there is no exit code to report and nothing crashed; what is observable
      // is that it stopped without finishing and without asking.
      //
      // WITHOUT ASKING is the half that earns the phrase, and it is not
      // rhetorical: a worker that stopped to ask is `waiting` and left in
      // WORKING by the arm far above — its question is its note. Reaching here
      // means the scan found no marker, so nobody was asked anything. That
      // distinction is exactly what a reader needs to know they are looking at
      // an abandonment rather than a question they overlooked.
      return {
        group: 'waiting-on-you',
        note: `worker stopped without finishing and without asking${what}${whereToLook(localWorktree)}`,
      };
    }
    if (worker === 'ended') {
      // THE THIRD BROKEN CASE, and it says only what it knows. `ended` is the
      // state that means *the status was not recorded* — so it names neither a
      // crash nor a clean stop, because the record that would settle which is
      // the thing that is missing. Guessing either way is the one answer that
      // tells a reader to stop looking, and the log is where the answer is.
      return {
        group: 'waiting-on-you',
        note: `worker stopped, exit status not recorded${whereToLook(localWorktree)}`,
      };
    }
  }

  if (state === 'claimed') {
    // `running` is handled ABOVE, for every unmerged state rather than for this
    // one — a live worker is direct evidence and outranks the clock in both
    // directions the clock gets wrong. The pid is the scan's, never re-derived
    // here: `kill -0 0` succeeds against the whole process group, so a pid of
    // `0` read on this side would be alive forever.
    // NO KNOWN WORKER, and the two ways of not knowing are different answers.
    //
    // Neither downgrades the group — absent is not false, and `plot-dispatch`
    // writes a pid only where it started the worker itself, so a hand-started
    // agent leaves none. Reading that as "nobody is working" would have reported
    // all five of one session's agents dead. What changes is the NOTE, which
    // stops claiming commits are on the way and says what is actually known.
    //
    // `elsewhere` is not a weaker `none`: the pid lives in the worktree, so a
    // branch claimed on another machine has nowhere here to look. Looking and
    // finding nothing sends the reader into this checkout; having nowhere to
    // look sends them to the machine that took it. Different errands, so
    // different sentences.
    const elsewhere = worker === 'elsewhere';
    const unstarted = elsewhere ? 'claimed elsewhere' : 'claimed, no known worker';
    // A claim IS a commit — the empty `plot: claim <branch>` push — so its age
    // is known and must be used. Sending every claim straight to `quiet` put a
    // branch claimed three minutes ago in the same group as one abandoned for
    // three weeks, and `quiet` means "go check whether it died". That is the
    // wrong prompt for work that just started, and it is the same mis-answer
    // already fixed for merged branches below: right state, wrong group.
    //
    // An agent that has claimed but not yet committed is the NORMAL opening of
    // every dispatch — it is reading the plan. Only once the quiet window has
    // passed with nothing committed does "go look" become the useful thing to
    // say.
    //
    // WORKING IS ABOUT AGENTS, NOT BRANCHES. A claimed branch with no known
    // worker is NOT STARTED — an agent may take it. The claim ref exists, but
    // until `worker === 'running'` or `worker === 'waiting'`, no agent is on
    // it. See `every-section-has-one-subject`, slice Inverted.
    if (ageMinutes !== null && ageMinutes <= quietMinutes) {
      return { group: 'not-started', note: unstarted };
    }
    if (localDirty || localAhead > 0 || localLocked) {
      return localActivity(localDirty, localAhead, localLocked);
    }
    // AN ORPHANED CLAIM, AND THE RULE NAMES IT. `state === 'claimed'` IS
    // `isEmptyClaim`: the scan reaches that word only where a branch's commits
    // beyond main are all empty `plot: claim` markers — *"A CLAIM is a branch
    // whose only commits beyond main are claim commits"*, `plot-fleet-scan.sh`
    // — which is the same definition `QuietBranchReadings.isEmptyClaim` takes
    // from `ClaimRefReadings`. So the reading is read off the state rather than
    // re-derived, and no new field crosses the pulse.
    //
    // WAITING ON YOU, NOT QUIET, and that move is the half this slice exists
    // for. `quietNeedsPerson` says an orphaned claim is still somebody's to
    // answer — a branch nobody started, holding a worktree slot — and the group
    // is the half that asks. QUIET means *go check whether it died*; nothing
    // died here, and there is nothing to check: the claim is the whole of what
    // happened. #669 relabelled a row and left its group, and the row went on
    // asking for a decision its own sentence said was made; this plan's own
    // notes call that the error not to repeat.
    //
    // THE AGE RIDES BESIDE THE SENTENCE, never instead of it. Age is what the
    // fallthrough said when it had nothing else, and it is the fact this rule
    // exists to stop standing in for a state — but *how long has nobody
    // started this* is exactly the question a reader answers a stale claim
    // with, so it is appended where it is known. `quietNote` supplies the
    // state; this supplies the duration; neither is asked to be the other.
    const orphaned = quietNote(claimedReadings(pr));
    return {
      group: 'waiting-on-you',
      note:
        ageMinutes === null
          ? withNote(orphaned, elsewhere ? 'claimed elsewhere' : '')
          : withNote(
            `${orphaned} — claimed ${humanAge(ageMinutes)} ago`,
            elsewhere ? 'claimed elsewhere' : '',
          ),
    };
  }
  if (state === 'merged') {
    // Merged work is DONE, not quiet. "Go check whether it died" is the wrong
    // prompt for a branch that landed — putting it in `quiet` was the first
    // thing that looked wrong on screen, and it is a real mis-answer rather
    // than a cosmetic one.
    return verdict === 'complete'
      ? { group: 'done', note: 'merged' }
      : { group: 'done', note: 'merged — slice still open' };
  }
  // state === 'wip'
  //
  // WORKING IS ABOUT AGENTS. A branch with recent commits but no known agent
  // is NOT STARTED — an agent may take it. The commit shows activity, but
  // until `worker === 'running'` or `worker === 'waiting'`, no agent is on it.
  // See `every-section-has-one-subject`, slice Inverted.
  if (ageMinutes !== null && ageMinutes <= quietMinutes) {
    return { group: 'not-started', note: `last commit ${humanAge(ageMinutes)} ago` };
  }
  if (localDirty || localAhead > 0 || localLocked) {
    return localActivity(localDirty, localAhead, localLocked);
  }
  // ABANDONED, AND THE RULE DECIDES WHICH. Reaching here with `state === 'wip'`
  // means real commits, no local activity, and — because the PR arm far above
  // catches every branch carrying an open one — NO OPEN PR. That is
  // `quietKind`'s `abandoned` exactly: *real commits, no PR ever opened, nobody
  // on it*, the six rows measured on this estate 2026-09-03.
  //
  // WAITING ON YOU, because it is the one kind that genuinely needs a person:
  // revive it, or drop it. The plan says so and `quietNeedsPerson` says so, and
  // QUIET's own hint — *still thinking, or dead?* — is a question this row has
  // already answered.
  //
  // THE AGE FOLLOWS THE STATE rather than replacing it, the same shape as the
  // orphaned claim above. *no commit for 126 days* was the whole note and it
  // named a duration where a state belonged; *how long* is still the fact the
  // revive-or-drop call turns on, so it is said second and only where known.
  // THE KIND DECIDES THE SECTION, not this arm. `waiting-on-you` was hardcoded
  // here, so a merged branch got the right sentence in the wrong place — the
  // same half-fix #669 made on the withdrawn-plan row and #675 had to finish.
  // The group is the part that asks a person for something, and nobody is
  // waiting on work the host already merged.
  const readings = wipReadings(pr, hasMergedPr);
  const abandoned = quietNote(readings);
  // MERGED IS DONE, AND THIS ARM IS WHERE IT HAS TO BE SAID. `quietNeedsPerson`
  // releases only `closed-pr`, and `quiet.test.ts` states why: a merged branch
  // "answers `quiet` here and `classifyGroup` places it as done, above this
  // rule." That premise holds for a branch the scan marks `merged` — and this
  // arm is reached by one that squash-merged with its head ref deleted, which
  // arrives `wip` with no open PR and never meets the arm above.
  const group: WaitingGroup = hasMergedPr || !quietNeedsPerson(readings)
    ? 'quiet'
    : 'waiting-on-you';
  if (ageMinutes === null) {
    return { group, note: `${abandoned}, age unknown` };
  }
  return { group, note: `${abandoned} — last commit ${humanAge(ageMinutes)} ago` };
}

/**
 * What a `claimed` branch is, as {@link QuietBranchReadings}.
 *
 * `isEmptyClaim: true` IS THE STATE, not an assumption about it.
 * `plot-fleet-scan.sh` answers `claimed` only for a branch whose commits beyond
 * the default branch are all empty `plot: claim` markers, which is the
 * definition `ClaimRefReadings` gave the field. A branch carrying real work
 * reads `wip` there and never reaches this function.
 *
 * `hasMergedPr: false` because a merged branch reads `merged` from the scan and
 * is answered two arms above this one — it cannot arrive here.
 *
 * @param pr - the branch's OPEN PR, or null. Open-only by `classifyGroup`'s
 * contract, so `'closed'` is not reachable from here; the closed case is
 * `prState`'s and is read in `rowsFromPulse`.
 * @returns the readings for a claim nobody has worked.
 */
const claimedReadings = (pr?: PrRecord | null): QuietBranchReadings => ({
  branch: '',
  prState: pr ? 'open' : 'none',
  hasMergedPr: false,
  isEmptyClaim: true,
});

/**
 * What a `wip` branch nobody is on is, as {@link QuietBranchReadings}.
 *
 * `isEmptyClaim: false` IS THE STATE: `wip` is what the scan answers for a
 * branch carrying real commits, and it is the state `claimed` exists to be
 * distinguished from.
 *
 * @param pr - the branch's OPEN PR, or null. A branch WITH one never reaches
 * the fallthrough — the PR arm above answers it — so this is `null` in
 * practice and passed anyway rather than assumed, since an assumption here
 * would be the rule re-derived on this side.
 * @returns the readings for pushed work nobody is on.
 */
const wipReadings = (pr?: PrRecord | null, hasMergedPr = false): QuietBranchReadings => ({
  branch: '',
  prState: pr ? 'open' : 'none',
  hasMergedPr,
  isEmptyClaim: false,
});

/**
 * What a branch whose PR the host CLOSED is, as {@link QuietBranchReadings}.
 *
 * Read in `rowsFromPulse`, never in `classifyGroup` — that function's `pr` is
 * open-only and it says so twice. The caller establishes `prState(held) ===
 * 'closed'` from the any-state map before asking, so this states the reading
 * the rule is being handed rather than deciding anything itself.
 *
 * `hasMergedPr: false` is not an assumption: `prStates` answers `closed` for
 * `state === 'CLOSED'`, and the caller excludes `b.state === 'merged'` beside
 * it — the branch-side fact that outranks the word, since some hosts spell a
 * merge `CLOSED`.
 *
 * `isEmptyClaim: false` because the decision outranks every fact about the
 * branch's contents: it does not matter how much work is on a branch somebody
 * rejected, which is the precedence `quietKind` states in its own second arm.
 *
 * @returns the readings for a declined PR.
 */
const closedReadings = (): QuietBranchReadings => ({
  branch: '',
  prState: 'closed',
  hasMergedPr: false,
  isEmptyClaim: false,
});

/**
 * Which kind of quiet this ROW is in, or null where the question is not asked.
 *
 * The row-level counterpart to the two arms inside `classifyGroup`: it answers
 * for a branch NOBODY IS ON, which is the population `quietKind` is about, and
 * says nothing about any other. See {@link AgentRow.quietKind} for why the
 * answer travels on the row rather than being derived in the view.
 *
 * NULL IS THE COMMON ANSWER AND IS NOT A FAILURE. A branch with a live agent, a
 * merged branch, a PR under review — none of them is quiet, and a kind attached
 * to one would be a claim about a state the rule never examined. Only the two
 * groups the quiet kinds actually land in are asked: `quiet`, and the
 * `waiting-on-you` rows that got there through the two fallthrough arms.
 *
 * IT REFUSES THE ROWS THAT REACH `waiting-on-you` BY EVERY OTHER ROUTE, and the
 * WORKER is the gate that matters. A `claimed` or `wip` branch also lands in
 * that section through the four broken-worker arms — `failed`, `finished`,
 * `stalled`, `ended` — and none of those is quiet: something ran, and what the
 * row asks for is a restart or a review. Reading one as `abandoned` would put
 * *nobody ever opened a PR* on a branch whose worker finished an hour ago.
 *
 * So the states that answer are the two the fallthrough arms are reachable
 * from: a worker that is absent (`none`, `elsewhere`) on a branch with no open
 * PR. A draft plan's branch is `open` and a shelved one is `deferred`, so both
 * fall out on the state gate without needing a phase.
 *
 * @param closed - `'closed'` where the any-state map reports a declined PR,
 * null otherwise. Passed rather than re-read, because the caller established it
 * against `b.state !== 'merged'` and a second reading could disagree.
 * @param state - the branch's state as the scan answered it.
 * @param group - the section the row landed in.
 * @param worker - what the scan found out about a worker on the branch.
 * @param pr - the branch's OPEN PR, or null.
 * @returns the kind, or null where the branch is not one nobody is on.
 */
const rowQuietKind = (
  closed: 'closed' | null,
  state: BranchState,
  group: WaitingGroup,
  worker: WorkerState,
  pr?: PrRecord | null,
  /** Whether the host merged ANY PR from this branch — see `classifyGroup`. */
  merged = false,
): QuietKind | null => {
  if (closed) return quietKind(closedReadings());
  if (group !== 'waiting-on-you') return null;
  // ABSENT IS THE ONLY ANSWER THAT REACHES THE FALLTHROUGH. Every other worker
  // state is handled by an arm above it, and each of those means something ran.
  if (worker !== 'none' && worker !== 'elsewhere') return null;
  if (state === 'claimed') return quietKind(claimedReadings(pr));
  if (state === 'wip' && !pr) return quietKind(wipReadings(pr, merged));
  return null;
};

/**
 * The processes this machine can see running for a branch — the entities the
 * WAITING ON A MACHINE section lists.
 *
 * A BUILD OR A PIPELINE, AND NOTHING ELSE. The section answers *what am I
 * waiting on?*, and the only honest answers are automated: a check running, a
 * build queued — something nobody can hurry and everybody must wait out.
 *
 * AN AGENT IS THE MACHINE, NEVER THE WAIT, and this function carried the
 * opposite claim until 2026-08-20. It pushed an `origin: 'local'` entry for
 * every `running` worker, on the argument that *"an agent watching its own CI"*
 * is two entities — an agent to list in WORKING and a process to list here.
 * The sections do list different things, which is precisely why the conclusion
 * does not follow: an agent watching its own CI is **two subjects, not one
 * subject twice.** The agent belongs in WORKING; the PR whose checks are
 * running belongs here, and it arrives on its own through the host half below.
 *
 * Measured on the live board 2026-08-20: `bug/one-component-renders-every-row`
 * appeared in WORKING *and* in WAITING ON A MACHINE, five minutes apart on one
 * screen, with **`pr: None`** — no CI, no check, nothing automated in sight. The
 * rule was keyed on a MECHANISM (*a process is running*) when the intent was a
 * SITUATION (*an agent is watching its own CI*), and an agent is always a
 * process — so the entry fired for every worker, including the ones with
 * nothing to wait on. WORKING already named it, and named it better, because it
 * says *who*.
 *
 * NO ROW IS LOST TO THE REMOVAL, and that was the objection raised against it:
 * *an agent that exited while its checks still run would land nowhere.* It
 * lands here by two paths that never consult a worker — the classifier's
 * `pr.checks === 'pending'` arm sets `group: 'waiting-on-machine'`, and the host
 * half below pushes an entry off the same reading. The local half was credited
 * with a case it never covered: the worker in that case is `finished`, so it
 * pushed nothing.
 *
 * DERIVED FROM WHAT THE PULSE ALREADY CARRIES, and deliberately nothing more.
 * `pr.checks` is read by `classify` two arguments away. No process enumeration,
 * no `ps`, no scanning for cwds inside worktrees: a sweep of that kind would
 * collect every editor and shell a person happens to have open in a checkout
 * and report them as machines working, and it would be a new cost on a scan
 * that is already 18.3 s.
 *
 * EVIDENCE, NEVER A FORECAST. The entry says what was observed and stops there.
 * GitHub publishes no remaining time for a queued check, so none is named — the
 * rule this plan estate repeats at every level, and the reason `evidence` is
 * prose beside a value rather than a verdict in place of one.
 */
export function machineProcesses(
  // THE WORKER ARGUMENTS SURVIVE THE ENTRY THEY FED, unread on purpose. Every
  // caller passes them positionally and the suite calls this with spread tuples
  // whose argument positions this file has broken once before; dropping two
  // parameters to delete one `if` would churn every call site for no behaviour.
  // Underscored so the compiler states the fact rather than tolerating it: this
  // function is handed a worker state and has nothing to say about it, which is
  // the whole point of the change.
  _worker: WorkerState,
  _workerPid: string,
  pr?: PrRecord | null,
): MachineProcess[] {
  const out: MachineProcess[] = [];
  // CI ON THE HOST — the one source this section has ever had, and now again the
  // only one. Kept verbatim through the local half's removal: its reading is
  // load-bearing and was never what the doubling was about.
  //
  // `pending` only, and read through `prState` for the reason the classifier
  // reads it there: a conflicting PR reports an EMPTY rollup, so `pr.checks`
  // alone would call it `none` and this would agree with a sentence the row does
  // not say. One derivation of the PR's state, used by both.
  if (pr && prState(pr) === 'pending') {
    out.push({
      origin: 'host',
      // The host's own wording, matching the note the row already carries so a
      // reader does not have to reconcile two sentences about one check. No
      // duration: a queued check publishes no finish time, and *CI will be done
      // in three minutes* is the claim this whole plan removes.
      evidence: `CI is running for PR #${pr.number}`,
      pid: '',
    });
  }
  return out;
}

/**
 * What kind of row this branch is: its section, its sentence, and the verdict of
 * the slice it sits in.
 *
 * THE THIRD ANSWER TRAVELS WITH THE OTHER TWO, and that is the whole reason it
 * is returned here rather than read off the slice by the caller. The note and the
 * verdict are two renderings of one input, and a consumer that finds them
 * disagreeing has found a bug it cannot act on — so they leave this function
 * together, from one reading of one `verdict` argument. `rowsFromPulse` has the
 * slice in hand and could take the field from there; that would be a SECOND
 * derivation, and the pair would then be able to drift.
 *
 * The signature is unchanged. Every caller — including the spread-tuple ones in
 * the suite, whose argument positions this file has broken once before — passes
 * exactly what it passed before and gets one more field back.
 */
export function classify(
  ...args: Parameters<typeof classifyGroup>
): { group: WaitingGroup; note: string; verdict: SliceVerdict | null } {
  // The verdict is WITHHELD when the PR is unknown and the slice verdict would
  // be `eligible`. `args[16]` is `prUnknown`; `args[1]` is the slice verdict
  // string. See the arm in `classifyGroup` for the group/note side; this is
  // the verdict side, and both must agree.
  const prUnknown = args[16] ?? false;
  const sliceVerdictStr = args[1];
  const withholdVerdict = prUnknown && sliceVerdictStr === 'eligible';
  return {
    ...classifyGroup(...args),
    verdict: withholdVerdict ? null : sliceVerdict(sliceVerdictStr),
  };
}

/**
 * Local activity on a branch WITHOUT a known agent → NOT STARTED.
 *
 * WORKING IS ABOUT AGENTS. A branch with local activity but no known worker is
 * an invitation to dispatch, not evidence that an agent is on it. The section
 * means *who is working*, and a dirty worktree or a lock does not answer that.
 * See `every-section-has-one-subject`, slice Inverted.
 *
 * The note describes WHAT was observed — uncommitted work, unpushed commits, a
 * write lock, a held checkout — and the reader infers whose. The section is
 * NOT STARTED because an agent may claim this branch; once `worker ===
 * 'running'` or `worker === 'waiting'`, the branch moves to WORKING through
 * the worker arm in `classifyGroup`, not through this function.
 *
 * This function replaced `workingLocally` on 2026-08-23: same notes, different
 * section. The notes kept their wording — a human reading "held in a local
 * worktree" should recognise it as the same fact, only filed where it belongs.
 */
function localActivity(
  dirty: boolean,
  ahead: number,
  locked = false,
  held = false,
): { group: WaitingGroup; note: string } {
  if (locked) return { group: 'not-started', note: 'a write is in progress in a local worktree' };
  // HELD WITH NOTHING ELSE TO REPORT. A worktree holds the branch, the tree is
  // clean, and `local_ahead` is 0 — which for a branch with no upstream is what
  // "could not compare" reports, not what "no commits" reports. So this says the
  // one thing that IS observed: somebody has this checked out. Saying
  // "uncommitted work" here would invent a fact; saying nothing put the row in
  // NOT STARTED as *nobody has taken it*, which is what sent a second agent at
  // finished work on 2026-08-20.
  //
  // `held` RATHER THAN THE RAW PATH. A path is present on a leftover worktree
  // too; `held` is the path with the merged tip already excluded, so only a
  // genuinely-held branch prints this note — the merged leftover it used to
  // fire on now stays in NOT STARTED, which is the whole of the fix.
  if (!dirty && ahead <= 0 && held) {
    return { group: 'not-started', note: 'held in a local worktree' };
  }
  if (ahead <= 0) return { group: 'not-started', note: 'uncommitted work in a local worktree' };
  const unpushed = `${ahead} commit${ahead === 1 ? '' : 's'} not pushed locally`;
  return {
    group: 'not-started',
    note: dirty ? `${unpushed}, uncommitted changes` : unpushed,
  };
}

/**
 * Review state is SHOWN, never gates. An agent waiting on a review is exactly
 * what the person reading the tab can resolve, so it must be visible — but
 * approved is approved with or without a review: a recorded approval is the
 * plan's `Approved:` record, not a host review. Nothing may treat this as a
 * condition, here or downstream in dispatch.
 *
 * An empty value produces no note, which is the honest rendering of "this host
 * has nothing to say about review" rather than "nobody has reviewed it".
 */
export function reviewNote(pr: PrRecord): string {
  switch (pr.review) {
    case 'APPROVED': return 'approved';
    case 'CHANGES_REQUESTED': return 'changes requested';
    case 'REVIEW_REQUIRED': return 'awaiting review';
    default: return '';
  }
}

/**
 * A draft PR's note: the draft framing, plus what its checks say inside it.
 *
 * Written as its own function rather than inline because the two facts are
 * independent — a draft can be green, red, running or unchecked — and the
 * defect being fixed was exactly one of them swallowing the other.
 *
 * `green` says nothing extra on purpose. "PR #131, draft" already means *not
 * ready for you*, and appending "checks green" would put the reassuring word on
 * the row whose whole point is that it is unfinished. Every other value is a
 * reason to look, so every other value is said.
 */
export function draftNote(pr: PrRecord): string {
  const base = `PR #${pr.number}, draft`;
  // Same precedence as `classify`, and for the same reason: a conflicting draft
  // reports an empty rollup, so reading `checks` first would say *no checks* on
  // every one of them. A draft is not exempt from needing a rebase.
  //
  // `unknown` mergeability sits directly below `conflicting`, exactly as in
  // `prState` and `classify`. Without it a draft whose mergeability could not be
  // read falls to its `checks`, and a green one then says nothing extra — the
  // silence that means *not ready for you, but otherwise fine* on a row where
  // the host declined to say so.
  const checks =
    pr.mergeable === 'conflicting' ? 'conflicts'
      : pr.mergeable !== 'mergeable' ? 'cannot say whether it merges'
        : pr.checks === 'failing' ? 'checks failing'
          : pr.checks === 'pending' ? 'CI running'
            : pr.checks === 'none' ? 'no checks'
              : pr.checks === 'unknown' ? 'cannot read the checks'
                : '';
  return withNote(checks ? `${base}, ${checks}` : base, reviewNote(pr));
}

/**
 * The PR's condition as a VALUE, for the row to render however it likes.
 *
 * The same facts `classify` spells into a sentence, stated as one of six words
 * instead. The note keeps everything a PR state cannot say — *uncommitted work*,
 * *blocked by an earlier slice*, *claimed elsewhere* — and is only relieved of
 * this one duty; what changes is that the PR's condition stops existing SOLELY
 * inside prose that a consumer would have to parse back apart.
 *
 * `conflicts` is checked FIRST, and that order is the whole point. GitHub starts
 * no workflow for a branch that does not merge cleanly, so a conflicting PR
 * always also reports an empty rollup: check `checks` first and every conflict
 * in the repo reads `none`. That is the defect being fixed — measured twice,
 * on PR #149 and PR #160, both of which said *no checks* while GitHub said
 * *this branch has conflicts that must be resolved*. The conflict is the cause;
 * the missing checks are its consequence, and a row that reports the consequence
 * has told the truth and hidden the reason.
 *
 * Only the literal `conflicting` promotes to `conflicts`. `unknown`
 * mergeability is not a conflict — but it is not a clearance either, and that
 * second half is what this function used to omit.
 *
 * UNKNOWN MERGEABILITY YIELDS `unknown`, BEFORE `checks` IS CONSULTED AT ALL.
 * Measured on PR #57, which read `green` in the agents row for 22 days while
 * the host said `mergeable=CONFLICTING`: under load GitHub returns `UNKNOWN`
 * for the lazily-computed mergeability while `statusCheckRollup` — a plain
 * stored field — still answers `green`. Falling through to `checks` then puts
 * the one word a reader acts on without checking onto a branch that cannot
 * merge. `green` says *this is fine, move on*; `pending` invites waiting and
 * `unknown` invites asking, so a stale `green` is worse than a stale anything.
 *
 * `checks` is not consulted to break the tie, and that is the point rather than
 * an omission: the two fields answer DIFFERENT QUESTIONS, and a green check
 * says nothing about whether a branch merges. Twenty-two days of green on a
 * conflicting branch is the proof.
 *
 * This is not only an outage case. Bitbucket reports `mergeable: "unknown"` on
 * every row, permanently — `bb` cannot answer the question — so `unknown` there
 * is the correct answer forever. The defect has not shipped on that host only
 * because the same adapter hard-codes `checks: "unknown"` as well, so the wrong
 * answer and the right one coincide by accident. Teaching that adapter real
 * checks would otherwise have shipped this defect on every Bitbucket row.
 *
 * `draft` is NOT consulted here. It is its own field on the row for the reason
 * `AgentPr` states: a draft has CI like anything else, and answering both
 * questions with one value is what kept WAITING ON A MACHINE empty.
 */
export function prState(pr: PrRecord): PrStateWord {
  // DERIVED FROM `prStates`, never computed a second time. The set is ordered
  // most-blocking first, so its head IS this answer — and deriving it here is
  // what makes `states[0] === state` true by construction rather than by two
  // functions agreeing. `classify` mirroring this function, and saying so in a
  // comment, is the cost of the other arrangement; one derivation is cheaper
  // than a mirror that has to be maintained.
  //
  // Non-empty on every input: `prStates` always answers at least `unknown`.
  return prStates(pr)[0];
}

/** The words a PR's condition can be reported in — see `AgentPr.states`. */
export type PrStateWord =
  'green' | 'pending' | 'failing' | 'none' | 'conflicts' | 'unknown' | 'closed';

/**
 * EVERYTHING the PR is waiting for, most-blocking first — see `AgentPr.states`.
 *
 * The primitive `prState` is now derived from. What it fixes is a loss that was
 * invisible in a single value: a PR that conflicts AND has a failed check
 * reported `conflicts` and the build failure was gone before the row was built.
 *
 * **The precedence is unchanged and the discarding is what stopped.** `conflicts`
 * still leads, for the reason `prState` has always given — GitHub starts no
 * workflow for a branch that does not merge, so a conflicting PR reports an
 * empty rollup and `none` there names the symptom while withholding the cause.
 * A conflicting PR whose checks DID run and DID fail is the case that value
 * could not express, and it is not hypothetical: a run can complete before main
 * moves underneath the branch.
 *
 * `unknown` AND `green` ARE ALWAYS ALONE, and the two early returns are what
 * guarantee it. Unknown mergeability poisons the checks answer as well — the
 * `green-never-outranks-unknown` rule this function has carried since #165 —
 * so it answers `['unknown']` and appends nothing: a second entry beside it
 * would claim a knowledge the row does not have. Green is the absence of every
 * errand rather than a peer of one, so nothing composes with it either.
 */
export function prStates(pr: PrRecord): [PrStateWord, ...PrStateWord[]] {
  // CLOSED OUTRANKS EVERY CHECK, and it has to come first — the same rule the
  // singular `prState` carried before this function existed, restored here
  // because this is now where precedence is decided.
  //
  // A closed PR is ABANDONED work — somebody decided against it. Its checks are
  // whatever they were when it was closed, and reporting `green` about it says
  // *this is ready* when the truth is *this was given up*.
  //
  // Measured on the live board 2026-08-21: PRs #51-#55, all CLOSED as drafts 26
  // days ago, rendered `green` + `draft` on five rows — the board reading *five
  // reviews are waiting on you* about a slice that was deliberately dropped.
  //
  // ALONE IN THE SET, not appended to. The set exists to report conditions a
  // reader can act on separately, and there is no errand beneath abandonment:
  // a failing check on a PR nobody will merge is not a second problem.
  //
  // `merged` is deliberately NOT given a state: a merged PR's row is already
  // `merged` via the branch state, and the two vocabularies would then disagree
  // about the same row.
  if (pr.state === 'CLOSED') return ['closed'];
  // Anything that is not one of the two ANSWERS counts, not just the literal
  // word: an adapter predating the field, and a word from a future host, are
  // both in exactly the position Bitbucket is in. The ingest normalizes absent
  // to `'unknown'` already, so this is belt-and-braces there — but `prStates` is
  // exported and called directly, and a pure function that says `green` on a
  // record it was handed without the field would be a defect one call site away.
  //
  // ABOVE the conflict check, unlike the old ordering, and that is not a change
  // of precedence: `mergeable === 'conflicting'` and `mergeable !== 'mergeable'`
  // are disjoint, so no input reaches a different answer. It reads in the order
  // the field is actually consulted.
  if (pr.mergeable !== 'mergeable' && pr.mergeable !== 'conflicting') return ['unknown'];
  const checks = checkWord(pr.checks);
  if (pr.mergeable === 'conflicting') {
    // The conflict leads. The checks follow it ONLY where they are an errand of
    // their own: `none` beside a conflict is the empty rollup the conflict
    // CAUSED, so appending it would print the symptom next to its own cause as
    // though they were two problems. `pending` and `unknown` say nothing a
    // reader can act on beneath a conflict, and `green` is not an errand.
    return checks === 'failing' ? ['conflicts', 'failing'] : ['conflicts'];
  }
  return [checks];
}

/** One PR's check rollup as a word, with every unrecognised value as `unknown`. */
function checkWord(checks: PrRecord['checks']): PrStateWord {
  switch (checks) {
    case 'green': return 'green';
    case 'pending': return 'pending';
    case 'failing': return 'failing';
    case 'none': return 'none';
    // Anything the adapter could not report, including a value this build does
    // not know. A new word from a future host must read as "cannot say", never
    // as the reassuring end of the range.
    default: return 'unknown';
  }
}

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
export function prOutranks(candidate: PrRecord, held: PrRecord): boolean {
  const open = (pr: PrRecord) => pr.state === 'OPEN';
  if (open(candidate) !== open(held)) return open(candidate);
  return candidate.number > held.number;
}

/**
 * The branch a `changeset-release` PR rides on — the ONE name this file matches.
 *
 * A release reaches the board as a PR like any other, and nothing in its fields
 * distinguishes it: same head, same checks, same mergeability. What marks it is
 * the branch Changesets opens, and the name is a convention of the tool rather
 * than a guess about one — the same standing this file already grants
 * `idea/<slug>`, which `rowsFromPulse` reads to recover a plan slug.
 *
 * MATCHED HERE AND NOWHERE ELSE, which is the point of the constant. The plan
 * that introduced `kind` argued that a renderer deriving a row's kind would
 * have to hardcode this name or misclassify the row; hardcoding it in the
 * SERVER, once, beside the other convention it already reads, is the version of
 * that cost this contract accepts. A second copy on the client would be the
 * defect.
 *
 * Exported for test.
 */
export { RELEASE_BRANCH };

/**
 * The branch `/plot-idea` cuts for a plan under review — `idea/<slug>`.
 *
 * A CONVENTION PLOT WRITES, which is what makes reading it sound rather than a
 * guess: the same argument the row-building site makes when it recovers the plan
 * slug from this name. The prefix is configurable per repo (`Branch prefixes` in
 * `## Plot Config`), and `idea/` is the default every Plot repo starts from —
 * a repo that renames it loses the mark and gets a `pr` row, which is the
 * pre-2026-08-20 behaviour rather than a wrong answer.
 *
 * Exported for test.
 */
export const IDEA_BRANCH = /^idea\//;

/**
 * WHICH OF THE SEVEN a row is — the judgement `AgentRow.kind` carries.
 *
 * Made HERE because this is where all the facts are in hand at once. See
 * `RowKindSchema` for why it must not be remade in the renderer.
 *
 * The order of the three arms is the rule, and each earns its place:
 *
 *   1. **A release is a release**, whatever else is true of it. It is the one
 *      row nobody should merge by reflex, and the mark exists to stop that — so
 *      it cannot be outranked by the PR arm that would otherwise claim it.
 *   1b. **An `idea/` branch's PR is a `plan`**, for the same reason and by the
 *      same test: what the reader is deciding about is the PLAN, not the code.
 *      Technically it is a pull request — and that is exactly why the mark is
 *      needed, since without it a plan awaiting APPROVAL renders as one more
 *      open PR awaiting review, and the two ask for different acts. Merging it
 *      is `plot-approve.sh`'s job, which takes a plan and no branch.
 *
 *      The branch name is the whole detection, and it is a convention **Plot
 *      itself writes** (`/plot-idea` names the branch after the plan's slug) —
 *      not a guess about one, which is the argument the row-building site one
 *      screen down already makes for reading the slug out of the same name.
 *   2. **A merge conflict makes it a `branch`**, even with an open PR, because
 *      no PR resolves a conflict: the reader has to go to the branch and rebase.
 *      This is the rule `the-row-leads-with-its-subject` settled, applied here
 *      rather than restated per column.
 *   3. **Anything else with an open PR is a `pr`**, because the fix updates the
 *      PR — and 67 of 80 live rows carry both a branch and a PR, so this is the
 *      normal case rather than an edge.
 *
 * Everything remaining is a `branch`: a claim nobody has started, a quiet ref,
 * a merged branch whose PR has gone. `branch` is the fallback rather than a
 * fourth arm, because a row with no PR has nothing else it could be about.
 *
 * `build`, `agent` and `ticket` are NOT decided here — each is built elsewhere
 * and says its own kind at its own site, which is the same rule: the kind is
 * stated where the row is created. `plan` used to be in that list and now has
 * one arm here, because an idea branch's PR is a row this loop DOES build and
 * the fact that identifies it (the branch name) is in hand at this site.
 *
 * Exported for test.
 */
/**
 * WHAT A BRANCH CARRIES — the facts that decide what its row is about.
 *
 * ## The branch abstraction
 *
 * The operator's rule, 2026-08-21: *"the branch is carrying the information, but
 * we should only see a branch row if the branch does not carry a slice, and the
 * branch does not carry a draft plan, and the branch does not have a PR, and the
 * branch is not a release branch. These are distinct tests."*
 *
 * So a branch row is the FALLBACK, reached by answering no four times — and each
 * test is a property of the branch, named here rather than spelled as a
 * condition at a call site. `carriesSlice` and `carriesDraftPlan` are the two that
 * were previously implicit: the slice test lived in the CLIENT (`sliceGroupsFor`
 * grouping rows per section), and the draft-plan test was an inline regex.
 *
 * Splitting the decision across server and client is what cost tonight: a
 * slice-grouped branch lost its plan link, its stuck cell and its accessible name
 * one at a time, because the client was deciding a kind the server did not know
 * about. `RowKindSchema` states the rule this restores — the kind is the server's
 * judgement and must not be remade in the renderer.
 */
export interface BranchFacts {
  /** The ref's short name — `feature/x`, `idea/y`, `changeset-release/main`. */
  branch: string;
  /** Whether an open PR names it. NOT what condition the PR is in. */
  hasPr: boolean;
  /** Whether the SCAN found a conflict — never *whether one was looked for*. */
  conflicts: boolean;
  /** The slice it belongs to, or "" — a name only, never the test for one. */
  wave: string;
  /**
   * The plan this branch belongs to, or "" where none names it.
   *
   * THE TEST FOR A SLICE, and the slice's own name is not. A slice is the unit a
   * plan is cut into, so a branch no plan names cannot be in one whatever the
   * slice field says.
   */
  plan: string;
}

/** Is this the branch changesets cuts for a release? */
export function isReleaseBranch(f: Pick<BranchFacts, 'branch'>): boolean {
  return RELEASE_BRANCH.test(f.branch);
}

/**
 * Does it carry a plan?
 *
 * An `idea/<slug>` branch — `/plot-idea` names the branch after the plan's own
 * slug, so the prefix IS the statement that this branch carries a plan.
 *
 * **THE PR WAS REQUIRED UNTIL 2026-08-21**, on the reasoning that *a plan is not
 * under review until something asks for the review*. That reads the kind as a
 * phase, and it is not: the operator's rule is *"Ein plan Branch (idea/) mit oder
 * ohne PR ist ein PLAN"*. A plan written and not yet opened for review is still a
 * plan, and calling it a bare branch is exactly the confusion the kind exists to
 * remove — the reader is told *a name somebody pushed* about the one row that is
 * a document waiting for them.
 *
 * Where it is in its lifecycle belongs to the row's PHASE and its status, which
 * carry Draft, Approved and the rest. The kind says what the row IS; the status
 * says where it has got to. Same split as `release`, whose arm has always read
 * the ref name alone.
 */
export function carriesDraftPlan(f: Pick<BranchFacts, 'branch'>): boolean {
  return IDEA_BRANCH.test(f.branch);
}

/**
 * Does it belong to a slice — that is, does a plan name it?
 *
 * **THE PLAN IS THE TEST, and it replaced the slice's NAME on 2026-08-21.** This
 * read `wave !== UNNAMED_SLICE`, on the reasoning that *a slice with no name
 * cannot head a row, so a branch in one is just a branch*. That was true while a
 * slice was a heading. It is not true of a carrier: `MANIFESTO.md` gives a plan
 * with no subheadings one slice, so a plan nobody cut into `### ` sections
 * still has exactly one slice — an unnamed one — and its branch is that slice's
 * work.
 *
 * Measured when the operator caught it on the live board: a merged branch under
 * plan `the-no-ref-arm-asks-once-too`, with PR #255, rendering as `BRANCH`. Its
 * plan carries no `### ` heading, so its slice parsed as `(unnamed)` and the arm
 * refused it. 23 of this repo's 83 plans with a `## Branches` section have no
 * named slice — a template rule (*"EVERY wave gets a `### <Name>` heading"*) with
 * no gate behind it, violated 27% of the time.
 *
 * The operator's two rules settle both halves:
 *
 *   *"Ein branch der zu keinem Plan gehört ist keine WAVE"* — no plan, no slice.
 *   *"Ein PR der einen Branch hat der zu keinem Plan gehört ist ein PR"* — and
 *   what such a row IS instead is decided by the arm below this one.
 *
 * So the unnamed slice is a naming defect in the plan file, repaired by
 * `/plot-reslice`, and never a reason for the board to call a plan's work a bare
 * branch.
 */
export function carriesSlice(f: Pick<BranchFacts, 'plan'>): boolean {
  return Boolean(f.plan);
}

export function rowKind(
  branch: string,
  /**
   * WHETHER the row has a PR, not what condition it is in — and the boolean is
   * the honest signature.
   *
   * An earlier draft took the PR record so the arms could read its `state`, and
   * none of them do: `conflicts` arrives as its own argument, from the SCAN's
   * conflict set rather than from the host's mergeability, because those are
   * two different questions and only one of them is answered for a branch
   * nobody examined. A parameter carrying a condition no arm reads is a
   * standing invitation to start reading it, which is how a two-fact decision
   * quietly becomes a three-fact one.
   */
  hasPr: boolean,
  /**
   * Whether the scan FOUND a conflict — never *whether one was looked for*.
   *
   * The caller passes `conflicts_known && conflicts.length > 0`, so an
   * unexamined branch arrives as `false` and takes the PR arm. That is correct
   * and is the point: *not looked at* must not read as *clean*, and it must not
   * read as conflicting either. A branch whose conflict set was never computed
   * has produced no evidence for the branch arm.
   */
  conflicts: boolean,
  /**
   * The PLAN this branch belongs to, or "" — the test for a slice.
   *
   * It took the slice's NAME until 2026-08-21, and a name cannot answer the
   * question: a plan with no `### ` heading has one unnamed slice, and its branch
   * is that slice's work. `carriesSlice` states the operator's rule in full — no
   * plan, no slice.
   *
   * Last in the parameter list because it is the newest, so every existing caller
   * is unchanged and a caller that says nothing about a plan gets the behaviour
   * it had.
   */
  plan = '',
): RowKind {
  // ## A BRANCH ROW IS THE FALLBACK, and it takes four distinct negatives
  //
  // The operator's rule, 2026-08-21: *"we should only see a branch row if the
  // branch does not carry a slice, and the branch does not carry a draft plan, and
  // the branch does not have a PR, and the branch is not a release branch. These
  // are distinct tests."*
  //
  // Each arm below is one of those tests, in the order a stronger claim outranks
  // a weaker one. Everything that answers no to all four is a branch — a name
  // somebody pushed and nothing else is true of yet.
  //
  // **The SLICE test was being made in the CLIENT** until now, by `sliceGroupsFor`
  // grouping rows per section. That split the one decision across two places, and
  // the client's half could not see what the server had decided — which is why a
  // slice-grouped branch lost its plan link, its stuck cell and its accessible
  // name one at a time. `RowKindSchema` says this judgement is the server's and
  // must not be remade in the renderer; the slice arm belongs here with the rest.
  if (isReleaseBranch({ branch })) return 'release';
  // A PLAN AWAITING APPROVAL, not code awaiting review — see arm 1b. Ordered
  // ABOVE the conflict arm on purpose: a conflicting plan PR is still a plan,
  // and the act it wants is approval rather than a rebase. It is BELOW the
  // release arm only because the two cannot both match.
  if (carriesDraftPlan({ branch })) return 'plan';
  // A RUN IN PROGRESS IS A BUILD, and this arm is why the `build` kind existed
  // for weeks with nothing ever assigned to it — `tupleFromBuild` was written,
  // tested, and unreachable, because this function's own docstring said *"a build
  // and an agent have no row yet"* while `classify` was already routing these
  // rows to WAITING ON A MACHINE.
  //
  // The result was a section whose subject is *what is a machine doing* holding
  // a row labelled `PR`, with a note reading `CI is running for PR #304`.
  // Reported from a screenshot; the section knew, the kind did not.
  //
  // A CONFLICT MAKES IT A BRANCH even with an open PR, because no PR resolves a
  // conflict: the reader has to go to the branch and rebase. This is the one arm
  // that answers *yes* to a later test and still returns `branch`, and it is
  // deliberate — see the rule `the-row-leads-with-its-subject` settled.
  if (conflicts) return 'branch';
  // ## THE SLICE IS WHAT CARRIES THE PLAN, so it outranks what happens to it
  //
  // This arm was LAST until 2026-08-21, on the argument that a slice is *"the
  // weakest claim"* because it only says *which slice of a plan* a branch belongs
  // to. That was a mis-classification rather than a mis-ranking, and the method
  // this board serves had already written down why.
  //
  // *Ein Team, ein Plan, viele Agenten* — the published factsheet — names the
  // defect in the row: *"Sie sind nicht der Gegenstand, sie sind das Vehikel …
  // Wer die Zeile mit dem Branchnamen führt, zeigt allen dreien dasselbe
  // Gesicht."* Its table of what a person waits on keeps subject and vehicle in
  // separate columns: a SLICE is the subject, and it *"fährt auf einem Branch mit
  // Pull Request und eigenem Worktree auf"*. `rowKind` had the two in one column
  // and let the vehicle win.
  //
  // The model says the same: `plan → wave → branch`. A slice is what a plan is cut
  // into, what `plot-dispatch` claims, what a worktree exists for, and what must
  // finish before the next one opens. A PR, a run, a review are EVENTS at a
  // branch while its slice is carried out — each comes and goes without the slice
  // changing, and the slice cannot change without the plan's progress changing.
  // So the row is about the carrier; the events are its status, links and notes.
  //
  // The conflict arm above is the deliberate exception, and the same table argues
  // for it: *"Branch in Flug — fährt auf sich selbst — das Vehikel ist das
  // Problem"*. There the vehicle IS the subject.
  //
  // Two measurements corroborate and decide nothing, which is the right weight
  // for them: 67 of 76 rows on this repo's board are already `wave` and `build`
  // is 0 of 76, rendering in `mock-fleet.ts` and nowhere else. The count once
  // cited FOR `pr` inverts on reading — *67 of 80 rows carry BOTH a branch and a
  // PR* — so `pr` separated almost nothing.
  //
  // This is also the structural fix for a defect the `build` arm was patching.
  // That arm was added because WAITING ON A MACHINE showed a row labelled `PR`
  // whose note read *"CI is running for PR #304"* — the section knew and the kind
  // did not. Making the kind track the machine was one way to close the gap;
  // making the kind the SLICE closes it permanently, because a slice row cannot
  // contradict a section that is asking what is happening to a slice.
  if (carriesSlice({ plan })) return 'wave';
  if (hasPr) return 'pr';
  return 'branch';
}

/**
 * The PR fields a row carries: the link, and the two independent conditions.
 *
 * `state` and `states` both travel, and `state` is read out of `states` rather
 * than computed beside it — so the row cannot ship a head that disagrees with
 * its own winner. A consumer that wants *the one thing this waits for* reads
 * `state`; one that wants *what is true of this PR* reads `states`.
 */
export function agentPr(pr: PrRecord): {
  number: number; url: string; draft: boolean;
  state: PrStateWord; states: PrStateWord[];
} {
  const states = prStates(pr);
  return { number: pr.number, url: pr.url ?? '', draft: pr.draft === true, state: states[0], states };
}

function withNote(base: string, note: string): string {
  return note ? `${base} · ${note}` : base;
}

/**
 * Minutes are the right unit for the first hour and useless after that: a note
 * reading "no commit for 30300 min" is arithmetic the reader has to do.
 */
export function humanAge(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Actionable before diagnostic.
 *
 * `not-started` sits ABOVE `quiet` because the two ask different things of a
 * reader with a spare ten minutes: not-started is work they can pick up right
 * now, while quiet asks them to go investigate something that may already be
 * dead. Sorted this way the list stays workable top to bottom — the ordering
 * principle these groups have always had — rather than putting an errand before
 * an opportunity.
 */
export const GROUP_ORDER: WaitingGroup[] = [
  'waiting-on-you', 'working', 'waiting-on-machine', 'not-started', 'quiet', 'done',
];

/**
 * Order two rows of the SAME group.
 *
 * Everywhere but one group this is descending commit age: the longest
 * unattended work surfaces, which is what a reader scanning for neglect wants.
 * A missing age coerces to `-1` and falls to the end — "we do not know" is not
 * "ancient".
 *
 * `not-started` inverts, and consults a different clock entirely. Its rows have
 * no commit at all, so every one of them tied at `-1` under the general rule and
 * the group came out in whatever order the scan produced —
 * `feature/plot-sprint-support`, waiting since February, sat among branches
 * approved minutes earlier. The clock that dates them is `waitingDays`, from the
 * plan's `Approved:` record.
 *
 * The DIRECTION flips because old means something else here. Elsewhere old means
 * neglected and belongs on top; in this group it means *nobody wants it* — six
 * months of availability is evidence of that, not urgency — while a plan
 * approved minutes ago is the one still in the reader's head and the one a
 * dispatch is actually likely to pick up. A row with no date at all has just
 * arrived and has not yet been ignored by anyone, so it leads.
 *
 * Confined to this one group on purpose: a rule that flips direction depending
 * on where it is applied is two rules wearing one name, and applying it
 * generally would silently reverse `quiet`, the group that most needs
 * oldest-first.
 *
 * Exported for test — the current code ties every not-started row at `-1`, so
 * any order passes an assertion that only checks the rows are all present.
 */
export function compareWithinGroup(a: AgentRow, b: AgentRow): number {
  if (a.group === 'not-started') {
    // Ascending, and an absent date takes -1 so it sorts BELOW `today` (0)
    // rather than tying with it. The two are different statements — "approved
    // at an unknown time" and "approved today" — and `waitingDays` already
    // keeps them apart by storing null for the first.
    return (a.waitingDays ?? -1) - (b.waitingDays ?? -1);
  }
  return (b.ageMinutes ?? -1) - (a.ageMinutes ?? -1);
}

/**
 * Does this branch have its brief? `present`, `missing`, or `unknown`.
 *
 * THE THIRD ANSWER IS THE WHOLE REASON THIS IS NOT `existsSync` INLINE, and it
 * is what separates this from `attention.ts`'s boolean twin, which returns
 * `false` on any error. That boolean is right for its caller — an agent handed a
 * path either way, whose next move is to look. It is wrong for a ROW: *no brief
 * — write one first* is a claim about the repository, and made on the strength
 * of an unreadable `.plot/briefs` it sends a person to write a file that may
 * already be there.
 *
 * So the two failures are told apart by ASKING A SECOND QUESTION rather than by
 * inspecting an errno. A missing FILE is the common case and a real answer:
 * `plot-dispatch.sh` reports `brief=missing` unconditionally, because it cannot
 * write a brief and never will — that is interpretation, and `/plot-implement`
 * owns it. So most eligible branches genuinely have none. A DIRECTORY that
 * exists and will not be read is not evidence about the file, and `unknown` is
 * what the board says when it has not asked. The same shape
 * `plot-board-probe.sh` uses for auth and `conflicts_known` for an unexamined
 * branch.
 *
 * `existsSync` rather than a read: nothing here wants the contents, and it is
 * exactly the question. Measured 2026-08-19 on this repo — 60 branches, 100
 * iterations — 0.2 ms per pulse, against a scan that takes 14 s.
 *
 * DIRECTORY FIRST, and the order is load-bearing rather than an optimisation.
 * `existsSync` cannot distinguish its own two falses: it swallows the error and
 * returns `false` both for *not there* and for *could not look* — measured, on a
 * readable file inside a `0o000` directory. Asking about the directory with a
 * throwing call first is what makes the second call's `false` mean the one thing
 * it is allowed to mean.
 */
export function briefState(repoRoot: string, branch: string): BriefState {
  const rel = briefPathOf(branch);
  try {
    // Can the directory be READ AT ALL? `accessSync` throws where `existsSync`
    // would quietly answer `false`, which is the distinction this function
    // exists to preserve. A missing `.plot/briefs` is NOT unknown — a repo that
    // has never had a brief written honestly has no such directory, and every
    // branch in it is `missing`, which is the answer `/plot-implement` acts on.
    // Only a directory that EXISTS and will not be read is unanswerable.
    const dir = path.join(repoRoot, path.dirname(rel));
    if (fs.existsSync(dir)) fs.accessSync(dir, fs.constants.R_OK);
    return fs.existsSync(path.join(repoRoot, rel)) ? 'present' : 'missing';
  } catch {
    // The directory is there and would not answer. Not a claim about the file.
    return 'unknown';
  }
}

/**
 * Which plans claim each branch — the index that finds a double claim.
 *
 * Built once per pulse over the whole estate, because the question is about the
 * ESTATE and not about any one plan: a branch listed in two plans' `## Branches`
 * sections looks perfectly ordinary from inside either one.
 *
 * Only collisions are kept. The common answer is one plan, and a map holding
 * every branch would be a map nobody reads — the same rule `stuckState` follows
 * in returning null for a branch that is not stuck.
 */
// A DOUBLE CLAIM IS A DOMAIN RULE — a branch belongs to one plan, and two
// naming it means one of the two plan files is wrong. Moved to
// `packages/domain/src/rules/pulse.ts`; re-exported for this file's callers.
export { doubleClaimedBranches };


export function rowsFromPulse(
  pulse: FleetReading,
  ages: Map<string, number | null>,
  repo: string,
  quietMinutes: number,
  prs?: Map<string, PrRecord> | null,
  urlBase = '',
  approvedAt?: Map<string, number> | null,
  now = Date.now(),
  ideaPlans?: Map<string, string> | null,
  /**
   * The version each release branch would ship, by branch — see
   * `releaseVersions`. Threaded like `ideaPlans` and for the same reason: this
   * function is SYNCHRONOUS and cannot read git, so anything from a ref arrives
   * as a map the caller built.
   */
  versions?: Map<string, string> | null,
  /**
   * Recent CI runs per branch, for the failing ones — see `refreshRuns`. Last in
   * the parameter list because it is the newest, so every existing caller is
   * unchanged: a caller with nothing to say about a branch's history is a caller
   * that did not look, and the row then shows the other two evidence lines.
   */
  runs?: Map<string, StuckRun[]> | null,
  /**
   * What each `waiting` worker asked, by branch — see `workerQuestions`. Read
   * on the SCAN's clock, not this one: the map arrives already built, because
   * this function is the render path and a subprocess per row per poll is not a
   * cost it can carry.
   *
   * Last in the parameter list because it is the newest, so every existing
   * caller is unchanged. A caller with nothing to say passes nothing, and every
   * waiting row then reads *reason unavailable* — which is exactly true of a
   * caller that did not look.
   */
  questions?: Map<string, string> | null,
  /**
   * Every PR keyed by head — merged and closed included — for the LINK only.
   * See `CacheEntry.prsByHead`.
   *
   * A SECOND MAP RATHER THAN A WIDER `prs`, and the split is the whole design.
   * `prs` decides the group and the note, and it must stay open-only: a merged
   * PR handed to `classify` answers for a branch whose git state already has.
   * This one decides the address, where the same filter drops exactly the PRs a
   * reader most wants — a merged one, on a branch whose ref is gone.
   *
   * Last in the parameter list because it is the newest, so every existing
   * caller is unchanged. A caller passing nothing gets today's behaviour: the
   * open map answers both questions, and a merged branch shows no number — which
   * is what a caller that did not look should get, rather than a guess.
   */
  prsByHeadMap?: Map<string, PrRecord> | null,
  /**
   * The repository root, so a row can be asked whether its brief exists — the
   * one file a worker is told to read first. See `briefState`.
   *
   * A ROOT RATHER THAN A PREBUILT MAP, which is the opposite of the choice
   * `questions` above makes, and the difference is what each costs. A question
   * costs a subprocess per waiting row, so it is read on the scan's clock and
   * arrives already built. This is one `existsSync` — 0.2 ms per pulse for 60
   * branches, measured — so passing the root and looking here keeps the answer
   * as fresh as the row: a brief written between two pulses shows up on the
   * next one, where a map built at scan time would hold the older answer for as
   * long as the scan's cadence.
   *
   * Last in the parameter list because it is the newest, so every existing
   * caller is unchanged. A caller passing nothing has not looked, and every row
   * then reads `unknown` — which is exactly true of it, and renders as the board
   * did before the field existed.
   */
  repoRoot = '',
  /**
   * Which ACTIVE sprint lists each plan, keyed by plan SLUG — the plan file with
   * its date prefix and `.md` stripped, the same spelling the row writes into
   * `plan`. Built by the caller from {@link collectSprints}, because that read
   * touches `docs/sprints/` and this function is the synchronous render path: a
   * filesystem read here would be the cost `questions` and `versions` are threaded
   * as maps to avoid.
   *
   * A slug the map does not name gets `sprint: ''`, which is the honest answer
   * for a plan no active sprint commits to. Last in the parameter list because it
   * is the newest, so every existing caller is unchanged: a caller passing
   * nothing leaves every row's `sprint` empty — exactly the board that predates
   * the field.
   */
  sprintOf?: Map<string, string> | null,
  /**
   * Every remote branch with commits the default branch lacks — see
   * {@link unmergedBranches}. The set a branch must be IN to get a row from the
   * loop below, and the reason that loop is bounded.
   *
   * A SET RATHER THAN A LIST OF ROWS TO ADD, because the decision is this
   * function's: the guards that keep one branch off the board twice live here,
   * beside the rows they compare against, and a caller cannot see them.
   *
   * Last in the parameter list because it is the newest, so every existing
   * caller is unchanged. A caller passing nothing has not looked, and no branch
   * row is added — which is exactly the board that predates the field, rather
   * than a claim that nothing is unmerged.
   */
  unmerged?: Set<string> | null,
): AgentRow[] {
  const rows: AgentRow[] = [];
  // ONE PASS OVER THE ESTATE, before the plan loop — a double claim cannot be
  // seen from inside either plan that makes it.
  const doubleClaimed = doubleClaimedBranches(pulse);
  for (const plan of pulse.plans) {
    // A RELEASED PLAN HAS DRAINED, and the board has nothing left to say about
    // it. DONE is the RELEASE SCOPE — work that has landed and whose version has
    // NOT shipped, waiting on its endgame test — and `Released` is exactly the
    // leave-condition: `/plot-release` resolves the version from `git tag
    // --contains`, so `released` means *the release shipped* rather than a date
    // that can drift. The section is a queue that drains, not an archive that
    // decays, and cutting the version empties it.
    //
    // DROPPED HERE, at the PLAN, not filtered per row in `classify`. Three
    // reasons this is the plan's decision and not the branch's:
    //   - The scope is the plan's. A plan releases with ALL its slices at once —
    //     there is no partial release — so a released plan's every branch is out
    //     of scope together, and asking the question once per plan says that.
    //   - `classify` answers with one of six WaitingGroups and has no "not
    //     rendered" among them; a released row it kept would have to land in a
    //     section, and every section is a call to action a shipped plan is not.
    //   - This is the ONE place a row may be dropped from the board — the
    //     membership rule's easy failure is losing a live row silently, so the
    //     drop is confined to the single phase that licenses it and nothing else
    //     leaves for any other reason.
    //
    // `released` ONLY, never `delivered`: a delivered plan is complete and
    // unreleased — the core of the scope, ready for the endgame — and it stays.
    // The asymmetry is the design: every slice being complete is a MEASUREMENT,
    // releasing is a DECISION, and only the decision drains the queue.
    //
    // The rolling window is why this fires at all: the scan admits plans
    // delivered or released inside the last 24 h, so a freshly-released plan
    // reaches this loop and would otherwise crowd DONE with shipped work — 41 of
    // 61 DONE rows, measured 2026-08-23.
    if (plan.phase === 'released') continue;
    // WHICH earlier slice is blocking — the plan's FIRST incomplete one, read
    // once per plan rather than searched per row.
    //
    // The first, not the nearest: a row three slices down is released by its
    // predecessors in order, so the one a reader can do something about is the
    // one at the front of the queue. Naming a nearer slice that is itself
    // blocked would answer *blocked by which one* with another blocked thing.
    //
    // Empty name → null, never "": a plan with no `###` sub-headings has an
    // unnamed slice, and the row then keeps the old sentence (*blocked by an
    // earlier slice*) rather than printing `blocked by ``.
    //
    // TWO SEARCHES, NOT ONE — the split this slice exists for. The predicate was
    // `verdict !== 'complete'`, which is the blocklist-collapse shape
    // `green-never-outranks-unknown` removed from `prState`: it catches
    // everything but one good value, so `eligible` and `blocked` arrive as the
    // same answer. They are not. An ELIGIBLE slice is the one a person can start
    // — startable, unclaimed, at the front of the queue — and it is the honest
    // answer to *blocked by which one*. A BLOCKED slice is not: naming it
    // answers that question with another blocked thing, which the paragraph
    // above forbids and the old predicate permitted.
    //
    // They agree on today's pulses and that is precisely the danger. The scan
    // clears `prior_ok` at the first incomplete slice, so exactly one slice per
    // plan can be `eligible` and it is the first non-complete one — the two
    // predicates pick the same slice by an INVARIANT OF THE SCAN that this file
    // never states and does not own. A scan that ever reports two eligible
    // slices, or a blocked slice ahead of an eligible one, would make the old
    // predicate wrong silently. This one is right by its own reasoning.
    //
    // The fallback keeps the first-not-nearest property for the case the split
    // opens up: no eligible slice at all. That happens where every slice is
    // complete (no row is blocked, so nothing reads this) or where the scan
    // reports blocked slices with none eligible — and there the front of the
    // queue is still the most useful thing a reader can be pointed at.
    const eligibleSlice = plan.slices.find((w) => w.verdict === 'eligible');
    const blocker = eligibleSlice ?? plan.slices.find((w) => w.verdict !== 'complete');
    const blockerName = blocker?.name?.trim() ? blocker.name.trim() : null;
    // HOW MANY branches are left in the blocking slice — the second half of the
    // sentence *blocked by Fold — 2 outstanding*. The scan already decides this
    // number (`plot-fleet-scan.sh` Pass 2); it just ships the list rather than
    // the count, and Principle 3 puts the counting on this side. A branch is
    // outstanding when it is neither deferred nor merged — the SAME predicate the
    // scan uses to settle a slice, so the board's count and the scan's verdict
    // read one fact. Derived per plan beside the name, since both answer the same
    // reader's question about the same slice.
    const blockerOutstanding = blocker
      ? blocker.branches.filter((w) => !w.deferred && w.state !== 'merged').length
      : 0;
    for (const wave of plan.slices) {
      for (const b of wave.branches) {
        const age = ages.get(b.branch) ?? null;
        const pr = prs?.get(b.branch) ?? null;
        // TWO LOOKUPS, ONE FETCH — the split `prsByHeadMap` documents. `pr` is
        // the OPEN PR and answers *what is this branch waiting for*; `linked` is
        // whichever PR this head carries, in any state, and answers *where do I
        // go to read it*. They are the same record on an open branch and differ
        // only after a merge, which is precisely the case that was losing its
        // link.
        //
        // A CLOSED PR IS AN ENDED ARTIFACT, NOT AN ENDED BRANCH. `prOutranks`
        // already prefers an open PR over a closed one — "a head can carry
        // several PRs over its life — a closed attempt and its reopened
        // successor" — but it ranks what EXISTS and never asks whether the
        // winner is worth showing. Where a head's ONLY PR is closed, that rank
        // hands the row a withdrawn attempt.
        //
        // Measured 2026-08-24: ten branches were in exactly that state, every
        // one of them with a single closed PR. `feature/the-plan-row-carries-
        // slice-actions` rendered `worker finished — review it` over a PR closed
        // as superseded an hour earlier, so the board asked a reader to review
        // something that had been withdrawn.
        //
        // THE SLICE LIVES ON IN THE BRANCH. Work continues toward another PR, so
        // hiding the closed one leaves the row saying what remains true — the
        // branch, its slice, its git state — and stops it citing an artifact that
        // ended. This is a display decision and touches no verdict: `classify`
        // already receives `pr` (open-only), so the slice arithmetic is
        // unchanged either way.
        const held = prsByHeadMap?.get(b.branch) ?? null;
        const linked = held && held.state === 'CLOSED' ? pr : (held ?? pr);
        const { group: openGroup, note: openNote, verdict } = classify(
          b.state, wave.verdict, age, quietMinutes, pr, b.local_dirty, b.local_ahead,
          // The plan's own phase, which the pulse has carried since #140 and
          // nothing read. It is the half git cannot answer: every branch of a
          // drafted plan is `open` with no ref, exactly like a branch of an
          // approved plan nobody has started.
          plan.phase,
          // Whether anything is actually running on the branch. The pid and the
          // exit code travel as the SCAN read them — the pid-of-0 trap was
          // sprung once already by re-deriving liveness, and this layer only
          // renders what it is handed.
          b.worker, b.worker_exit, b.worker_pid,
          // A write in progress at this instant — the third local signal, and
          // the only one that can go stale before the next poll. Like its two
          // neighbours it may only lift a row out of quiet.
          b.local_locked,
          // What a `stalled` worker left uncommitted, so the note can name it.
          // Empty for every other state, and empty adds nothing.
          b.worker_dirty_paths,
          // What a `waiting` worker asked, so the row says what it waits ON.
          // Absent for every other state; absent HERE, on a waiting row, is the
          // stated unknown — never a question invented to fill the sentence.
          questions?.get(b.branch) ?? '',
          // Whether a worktree HOLDS this branch — the path with the merged tip
          // excluded, the AND the scan computed. It decides the WORKING lift, so
          // a leftover worktree on a merged branch stays in NOT STARTED instead
          // of reading as somebody working.
          b.held,
          // WHERE TO LOOK when the worker broke — the path, which `held` above
          // deliberately does not carry because a lift must not be decided on a
          // path's presence. This decides nothing; it lands in the sentence of a
          // `failed`, `ended` or `stalled` row so a reader can go read the log.
          //
          // The note above this line said the path was NOT passed here, and that
          // it names the place through the pulse's `worktrees` list instead. That
          // was true while no note needed it: the list serves the plan modal,
          // which is a place a reader navigates TO. A broken agent's row has to
          // carry the location itself — it is read in a list, often over a
          // terminal, by someone deciding whether to open anything at all.
          b.local_worktree,
          // Whether this branch's PR could not be read from the origin — see
          // `PR_UNKNOWN_NOTE`. `held` is the any-state map (merged, closed,
          // unknown alike), so `state === 'unknown'` here means the host
          // answered but could not report the PR's state — a spent quota, an
          // unreachable server, a backend that returned successfully with no
          // data. When true and the slice verdict would be `eligible`, the
          // verdict is withheld: the row says the host could not be asked
          // rather than claiming the branch is ready for an agent.
          held?.state === 'unknown',
          // WHY a deferred branch was given up, so the row can say it instead of
          // reporting a review nobody is running. Read on a `deferred` branch of
          // a `draft` plan only; empty everywhere else, and empty falls back to
          // the phase sentence.
          b.deferred_reason);
        // THE CLOSED PR, READ HERE BECAUSE `classifyGroup` CANNOT SEE ONE.
        //
        // That function states the rule twice and records the mistake being
        // made against it: *"NO `CLOSED` ARM HERE… the `byHead` map is
        // open-only, so a closed PR never arrives — an arm for it would be dead
        // code. I wrote one on 2026-08-21 before reading that line; `prState`
        // is where the closed case belongs."* So the reading is taken from
        // `prState(held)` — the any-state map — at the one place both maps are
        // in hand, and `classifyGroup` gains nothing.
        //
        // IT STAYS ON THE BOARD. An earlier draft of this slice had a declined
        // PR leave, and the measurement disproved it on 2026-09-03: #53, #363
        // and #654 all still have LIVE REFS. The branch exists, still holds a
        // worktree slot, and is still findable by everything except the surface
        // a person acts through — so hiding it would make the board lie in the
        // other direction. QUIET, not DONE: DONE would read a declined branch
        // as an equal outcome to a merged one.
        //
        // AND IT ASKS FOR NOTHING, which is the move. `quietNeedsPerson` lets a
        // closed PR go — somebody already decided, and a decision is not a
        // thing to look at. It is the answer that empties 17 of this estate's
        // 26 quiet rows and the reason the other kinds are readable at all.
        //
        // `hasMergedPr` OUTRANKS THE WORD, and it has to: a merged PR reports
        // `CLOSED` through some hosts, so reading `state === 'CLOSED'` alone
        // would file every merged branch as a rejection. `prState` already
        // draws that line — it answers `closed` only where the host closed
        // without merging — so the rule is handed its verdict rather than the
        // raw field, and `merged` travels beside it for the rule to outrank.
        const closedPr = held && prState(held) === 'closed' && b.state !== 'merged';
        const group = closedPr ? 'quiet' : openGroup;
        // THE SENTENCE WITHOUT A `PR #n` PREFIX, deliberately, and this is the
        // one arm where that matters. `noteWithoutPr` strips everything from
        // `PR #n` up to the first ` · ` — on the reasoning that a prefix states
        // *the PR's own condition, which the cell now carries* — so a note
        // reading `PR #53, PR closed without merging` renders as the empty
        // string and the row says only `closed`.
        //
        // That reasoning is right for `PR #53, checks failing`, where slot 5
        // renders `failing` and the clause is a duplicate. It is wrong here:
        // slot 5 renders `closed`, a WORD, while the sentence is what says the
        // decision was to decline rather than that the artifact is shut. The
        // number is not lost either — it is an artifact link in slot 4, on
        // every kind that has one.
        const note = closedPr ? withNote(quietNote(closedReadings()), reviewNote(held)) : openNote;
        // WHICH KIND OF QUIET, carried onto the row so the client renders it
        // instead of deriving a word from `state`. See `AgentRow.quietKind`:
        // `stateStatus` maps `wip` to *in progress*, which is what the board
        // said about six branches four months idle on an estate running zero
        // workers.
        //
        // Asked of the SAME readings the group and the note came from, so the
        // three cannot describe different branches — the shape `quietNote`
        // itself uses when it asks `quietKind` rather than restating its arms.
        // `b.state === 'merged'` IS THE MERGED FACT, and it is the scan's own
        // answer rather than one re-derived from the PR here. `closedPr` above
        // already trusts it for the same reason.
        const kind = rowQuietKind(
          closedPr ? 'closed' : null, b.state, group, b.worker, pr, b.state === 'merged');
        // Derived once, read twice below — and derived from `group` rather than
        // re-deciding it, so a row `classify` placed outside `not-started`
        // cannot pick up a waiting-state by a rule that drifted apart from it.
        const waitingOn = waitingOnFor(group, b.state, wave.verdict, plan.phase);
        // The blocking slice's NAME goes into the sentence too, not only into
        // the field. `classify` cannot do it — the name lives on the plan's
        // slice list, which that function has never been given — so the note is
        // refined here, at the one place both are in hand.
        //
        // Through `blockedNote` rather than by concatenation: the unnamed form
        // stays a single declared constant, so a future reader can see which
        // spellings exist instead of finding three assembled variants.
        //
        // The COUNT rides with the name — `blockedNote` drops it where the slice
        // is unnamed, so an unnamed blocker keeps the bare sentence with nothing
        // dangling off it. It is the blocker's own outstanding count, derived
        // once per plan above.
        const rowNote =
          waitingOn === 'time' ? blockedNote(blockerName, blockerOutstanding) : note;
        rows.push({
          repo,
          // WHAT THIS ROW IS — decided here, where the branch name, the PR and
          // the conflict set are all in hand. See `rowKind`: a release outranks
          // everything, a conflict makes it a branch even with an open PR, and
          // an open PR otherwise wins.
          //
          // The conflict fact comes from `stuck`, computed a few lines below —
          // so it is read from the SCAN's own conflict set (`b.conflicts` with
          // `b.conflicts_known`) rather than from the summary, because an
          // unexamined branch reports no conflicts and *not looked at* must not
          // read as *clean*.
          kind: rowKind(
            b.branch,
            pr !== null,
            // A CLOSED PR'S CONFLICT DOES NOT MAKE IT A BRANCH.
            //
            // The conflict arm exists because *no PR resolves a conflict — the
            // reader has to go to the branch and rebase*. Nobody rebases
            // abandoned work, so on a closed PR the arm sends the row to a kind
            // that promises an act no one will perform.
            //
            // `stuckState` reaches the same conclusion one file over and drops
            // the cue; this keeps the KIND agreeing with it, which is the rule
            // `classify` states — *the row's word and its sentence must not be
            // able to disagree*.
            b.conflicts_known && b.conflicts.length > 0 && pr?.state !== 'CLOSED',
            // THE PLAN, which is what says this branch is a slice's work. Not the
            // slice's NAME: a plan with no `### ` heading has one unnamed slice and
            // its branch belongs to it all the same. Passing the name here sent a
            // merged branch under a real plan to `BRANCH`, which is the defect
            // this replaced.
            plan.file,
          ),
          branch: b.branch,
          plan: plan.file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''),
          planFile: plan.file,
          // WHICH ACTIVE SPRINT names this plan — joined on the slug, which is
          // exactly `plan` one line up. Read from the caller's map, "" when no
          // active sprint lists it: membership is the sprint FILE's list, not the
          // plan's own `Sprint:` field, so a plan the file omits carries no sprint
          // even where its field is filled. See `AgentRowSchema.sprint`.
          sprint: sprintOf?.get(plan.file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '')) ?? '',
          // NEVER A RELEASE, so never a version: this loop walks the branches a
          // PLAN names, and `changeset-release/*` belongs to no plan — it
          // reaches the board through the planless-PR loop below, which is where
          // the version is read.
          version: '',
          wave: wave.name || '(unnamed)',
          state: b.state,
          // WHY it was deferred, carried through from the plan's annotation.
          // Passed straight along rather than combined with the note: the note
          // is prose the row composes, and a reason the plan wrote is a fact
          // the row renders. "" everywhere the question does not arise.
          deferredReason: b.deferred_reason,
          // From the PAIR — see `rowPhase`. The plan supplies its phase; this
          // branch supplies the evidence that outranks a missing record.
          phase: rowPhase(plan.phase, b.state),
          group,
          ageMinutes: age,
          note: b.claimed ? `${rowNote} · ${b.claimed}` : rowNote,
          // The link the row could not offer before, and now the condition too.
          // `url` is the adapter's string or "", never anything this file
          // composed; `state` and `draft` are the same facts the note spells
          // out, stated as values so the cell can format them.
          //
          // FROM THE LINK MAP, falling back to the open one. `pr` above is
          // open-only because `classify` must not be told about a merge the git
          // state has already reported — but that filter also silenced the
          // number, and a merged PR is the one a reader still wants to open.
          // Measured on #252/#253/#254: merged, refs deleted, and every row
          // carried `pr: null` while the PR page was alive.
          //
          // The fallback is what keeps every existing caller working: pass no
          // link map and the open PR still answers, exactly as before.
          pr: linked ? agentPr(linked) : null,
          // A MERGED branch gets no link, even where the base is known: the
          // remote page is gone, and this file's standing rule is that a missing
          // address renders as plain text rather than as an invented one. The
          // `merged` state already says where the work went. "" everywhere too
          // when the origin was unrecognised — same rule, different reason.
          branchUrl:
            urlBase && b.state !== 'merged'
              ? `${urlBase}${b.branch.split('/').map(encodeURIComponent).join('/')}`
              : '',
          // How long this work has been WAITING to be started — a different
          // clock from `ageMinutes`, which everywhere else means "since the
          // branch tip moved". Days rather than minutes, and carried in its own
          // field for exactly that reason: overloading one field with two
          // meanings is how "22d, no commits" becomes indistinguishable from
          // "22d, never begun".
          //
          // Only where the row has no branch to date. A branch that exists has a
          // real tip age, and that is the more useful answer; the waiting age
          // would only compete with it.
          waitingDays:
            b.state === 'open' && approvedAt?.has(plan.file)
              ? Math.max(0, Math.floor((now - approvedAt.get(plan.file)!) / 86_400_000))
              : null,
          // The two local ACTIVITY signals, forwarded onto the row.
          //
          // They were already read three lines above — `classify` takes both —
          // and then dropped, so the sharpest facts the scan produces reached
          // the classifier and never the screen. `local_locked` in particular
          // was fought for in `board-survives-its-agents` precisely so a locked
          // worktree would stop reading as silence, and it stopped here.
          //
          // FORWARDED, never re-derived: the group and the marker must answer
          // from one reading of one scan, or a row can carry a marker its own
          // group disagrees with.
          //
          // `local_ahead` travels too, as of the slice that gave it its own mark
          // — and it travels SEPARATELY on purpose. It is finished work sitting
          // still rather than activity, so it must never be OR-ed into the
          // activity predicate: that would mark a branch nobody has touched for
          // hours as though someone were writing to it. Three fields, two
          // meanings, and the row renders them as two marks.
          localDirty: b.local_dirty,
          // HOW LONG SINCE THE LAST WRITE, which is what makes a write an EVENT
          // rather than a standing condition — see `changed_ago_seconds`.
          changedAgo: b.changed_ago_seconds ?? null,
          // THE INSTANT, which is what the change mark watches. The age above
          // ticks with the clock; this moves only when something happens.
          changedAt: b.changed_at ?? null,
          localLocked: b.local_locked,
          localAhead: b.local_ahead,
          // WHAT THIS ROW IS WAITING FOR, as a value — computed from the same
          // inputs `classify` just used, so the colour and the sentence beside
          // it cannot disagree. See `waitingOnFor`.
          waitingOn,
          // WHETHER THE BRANCH HAS ITS BRIEF — the second half of *can this be
          // started*, and the half the row could not say.
          //
          // `waitingOn` above answers whether the SLICE ordering is satisfied;
          // this answers whether the branch has the specification a worker is
          // told to read first. Both must hold, and only the first was ever
          // reported — which is how nine rows read *eligible* on 2026-08-19
          // with zero briefs between them.
          //
          // ASKED FOR EVERY ROW, not only the startable ones, and the cost is
          // what makes that affordable: one `existsSync`, 0.2 ms per pulse for
          // 60 branches. Scoping the call to `not-started` would save nothing
          // measurable and would make the field mean *asked* on some rows and
          // *not asked* on others — a second meaning inside one value, which is
          // the shape this row keeps splitting apart.
          //
          // `unknown` where no root was passed: a caller that did not look, and
          // the renderer says nothing at all for it.
          brief: repoRoot ? briefState(repoRoot, b.branch) : 'unknown',
          // And by WHICH slice, where that is the answer. Only the server can
          // say: `verdict` lives on the slice, the row carries only its own
          // name. Null on every row that is not blocked, and on a blocked row
          // whose blocker has no name.
          blockedBy: waitingOn === 'time' ? blockerName : null,
          // THE SLICE'S VERDICT, as a value — from `classify`, which composed the
          // note beside it from the same reading. Not taken from `wave.verdict`
          // here, though it is in hand: that would be a second derivation of one
          // fact, and the field and the sentence could then drift apart. The
          // pair leaving one function together is what makes them checkable
          // against each other, which is what the tests do.
          //
          // On EVERY row, not only the blocked ones. `blockedBy` above is null
          // outside its one case because a name for a thing that is not
          // blocking is a false claim; a verdict is a fact about the slice
          // whatever the branch is doing, and a merged branch of a still-open
          // slice is precisely the row that had no way to say so.
          verdict,
          // WHETHER THIS ROW CAN BE STARTED — from the same facts `waitingOnFor`
          // reads, and answering the question a reader asks: *can I start this*.
          //
          // Four verdicts: `start-work`, `needs-brief`, `waiting-on-approval`,
          // `someone-is-on-it`. Null where the question does not apply — merged,
          // deferred, or blocked by an earlier slice.
          //
          // THE ROW RENDERS THIS, NOT `eligible`. `eligible` answered a slice-
          // ordering question; this answers an actionability question. Measured:
          // 26 rows said `eligible` and 5 could be started. `isStartable` reads
          // this field rather than re-deriving it, so the row and the menu cannot
          // disagree.
          //
          // `brief` is computed a few lines above — the fact this field completes.
          startability: startabilityVerdict(
            b.state,
            plan.phase,
            wave.verdict,
            repoRoot ? briefState(repoRoot, b.branch) : 'unknown',
          ),
          // WHETHER IT CAN MOVE — a fact ADDED beside the group, never folded
          // into it. `classify` above answered what this branch IS; nothing it
          // can say means *this cannot advance without someone doing
          // something*, which is how five branches sat stuck for an afternoon
          // while every row read normal.
          //
          // The group, the state and the note are untouched. A stuck branch
          // keeps the group it belongs to; bending the group to encode
          // stuckness would put a conflicting PR and an unpushed rebase under
          // one heading, which is the shape this row keeps splitting apart.
          //
          // Null for a healthy branch, and that is most of them: a watcher that
          // flags everything flags nothing.
          stuck: stuckState({
            state: b.state,
            conflicts: b.conflicts,
            conflictsKnown: b.conflicts_known,
            localAhead: b.local_ahead,
            prState: pr ? prState(pr) : null,
            changedPaths: b.changed_paths,
            failingChecks: pr?.failing_checks ?? [],
            runHistory: runs?.get(b.branch) ?? [],
            // TWO PLANS CLAIMING ONE BRANCH — from the estate-wide index, since
            // the collision is invisible from inside either plan.
            claimedBy: doubleClaimed.get(b.branch) ?? [],
            // AND THE SLICE'S OTHER BRANCHES, where it holds more than one. A slice
            // is carried out in ONE branch and one worktree, so several means the
            // plan was never sliced after its spike. Read from the slice in hand —
            // no index needed, unlike the double claim.
            sliceSiblings: wave.branches.length > 1
              ? wave.branches.map((x) => x.branch)
              : [],
          }),
          // WHAT THE MACHINE DID ABOUT IT — beside the state, never folded into
          // it. A silent automatic write is indistinguishable from a defect, so
          // the row says a repair ran and how it ended, whether it pushed or
          // gave up. Null for every branch nothing was attempted on, which is
          // nearly all of them.
          repair: repairFor(b.branch, now),
          // WHAT THE SCAN FOUND OUT ABOUT A WORKER, forwarded onto the row.
          //
          // Read four lines above already — `classify` takes it — and then
          // dropped, so the only trace surviving onto the row was the SENTENCE
          // `classify` composed from it. That is precisely the shape
          // `localDirty` and `localLocked` were in before this same forwarding
          // fixed them, and it is the shape this file's own rules forbid
          // building on: `isStartable` was moved off `note === ELIGIBLE_NOTE`
          // for the reason that a reworded note breaks such a consumer
          // silently.
          //
          // It matters most for the two states whose moves are OPPOSITE:
          // `waiting` says answer it, `stalled` says resume it, and a consumer
          // reduced to matching prose to tell them apart is one rewording away
          // from restarting a worker into the question it asked.
          //
          // FORWARDED, NEVER RE-DERIVED — the same rule as its neighbours, and
          // sharper here: liveness is decided once, in the shared classifier,
          // and a structural test asserts it. This carries that verdict
          // outward; it does not form a second one.
          worker: b.worker,
          // WHICH KIND OF RUNNING, beside the state that says it is running at
          // all. Forwarded exactly as `worker` is — the scan sampled the child's
          // CPU once, and this carries that verdict outward rather than measuring
          // liveness a second time on this side. Empty except beside `running`.
          worker_activity: b.worker_activity,
          // THE PROCESSES, BESIDE THE AGENT — never instead of it. `worker`
          // above says which agent holds this branch; this says which processes
          // are running for it, and the WAITING ON A MACHINE section lists
          // these while WORKING lists that. A live worker with a pending check
          // therefore produces an agent entry and a process entry from one
          // reading of one pulse, which is what makes them unable to disagree.
          //
          // Derived here rather than in `classify` because `classify` answers a
          // SINGLE placement by contract, and threading a list out of its
          // thirty returns would put thirty chances to forget it where there is
          // one. Same argument the slice verdict settled by computing at one
          // exit.
          processes: machineProcesses(b.worker, b.worker_pid, pr),
          // WHAT THE MONITORS FOUND, forwarded onto the row exactly as
          // `worker` above is. Read from the desk the finding was written on —
          // `b.local_worktree` — so a branch checked out nowhere here reports
          // [] and claims nothing about a machine it cannot see.
          //
          // READ HERE RATHER THAN THREADED AS A MAP, the choice `briefState` a
          // few lines up makes and for its reason: this is a `readFileSync`
          // per watched worktree, not a subprocess, and the freshness is the
          // point. An `owes a review` entry must disappear on the pulse after
          // the PR is opened — the monitor publishes `clear` and the next read
          // sees it — where a map built on the scan's clock would hold the
          // stale debt for as long as the scan's cadence.
          findings: findingsFor(b.local_worktree, b.branch),
          // WHICH KIND OF QUIET, where nobody is on the branch — see
          // `rowQuietKind`. Null on every other row, and null is the question
          // not being asked rather than an answer of "none".
          quietKind: kind,
        });
      }
    }
  }

  // A branch no plan names is still work waiting on a person.
  //
  // The pulse walks the branches a plan lists under `## Branches`, which is what
  // makes this a FLEET view rather than a branch listing — main, release
  // branches and stale worktree refs stay out of it. But a fix branch opened
  // outside a plan carries the one thing this tab exists to surface, and could
  // not show it: two PRs sat waiting to be merged while WAITING ON YOU read
  // "none", and the pulse reported 8 branches where origin had 20.
  //
  // OPEN only, deliberately. A merged PR with no plan is finished work, and
  // letting it in would fill `done` with housekeeping nobody reads. The rule is
  // narrow on purpose: an open PR is waiting on somebody, whether or not a plan
  // claims it.
  //
  // No new host call — `prs` is the map the board already fetches on its own
  // slow timer, keyed by head branch.
  const planned = new Set(rows.map((r) => r.branch));
  for (const [branch, pr] of prs ?? []) {
    if (pr.state !== 'OPEN' || planned.has(branch)) continue;
    const ageMinutes = ages.get(branch) ?? null;
    // `state: 'wip'` is the honest git answer: the branch exists and carries
    // work. It also lets `classify` reach its PR arm, which is where an open
    // PR's checks decide between waiting-on-you and waiting-on-machine — the
    // group that had never once been populated, because the branches carrying
    // CI state were the ones missing from this list.
    // A DRAFT PR is waiting on you — to finish it, not to review it. Falling
    // through to the git answer put it in `quiet`, which means "go check
    // whether this died": the wrong errand for a plan written an hour ago.
    // `classify` deliberately declines to claim a green draft ("a draft is
    // still the author's, not yours"), and that is right for its own question;
    // here the author IS the reader, so the row says so plainly.
    //
    // The draft shortcut answers the GROUP and nothing else. It used to answer
    // the note too, and that collapsed a green draft and a red one into the
    // identical row: this plan's own PR reported `checks: failing` and rendered
    // `PR #131, draft`. Both halves were right about their own question —
    // `classify` declines to claim a green draft, and the shortcut is right that
    // a draft belongs in waiting-on-you regardless, since the author IS the
    // reader — but neither noticed that the shortcut answered for EVERY draft,
    // losing the one fact that changes what the author should do next.
    //
    // So the checks speak inside the draft framing, and the group stays put: a
    // failing draft is still waiting on its author, and moving it would claim a
    // review nobody asked for.
    const { group, note } = pr.draft
      ? { group: 'waiting-on-you' as const, note: draftNote(pr) }
      : classify('wip', 'eligible', ageMinutes, quietMinutes, pr);
    // An idea branch is not planless — it CARRIES the plan it introduces, and
    // `/plot-idea` names it `idea/<slug>` after that plan's own slug. Grouping
    // such a row under "" put two unrelated PRs under one nameless heading and
    // hid a plan that exists. The plan file is the branch's own, so it is not
    // in this pulse (which reads the default branch) and the name is all there
    // is to go on — but the name is a convention Plot itself writes, not a
    // guess about it.
    //
    // Only the slug is claimed. `planFile` stays empty, so the heading renders
    // as text rather than linking to a plan file this view cannot resolve —
    // the same rule the rows already follow.
    const ideaSlug = /^idea\/(.+)$/.exec(branch)?.[1] ?? '';
    rows.push({
      repo,
      // WHAT THIS ROW IS. Every row here has an open PR by the filter above, so
      // the ordinary answer is `pr` — and this is the site where the release
      // arm earns its keep: `changeset-release/main` reaches the board through
      // THIS loop, because no plan names it. Without the mark it renders as one
      // more open PR awaiting review, which is the row this repo must not merge
      // by reflex.
      //
      // `false` for conflicts, and it is the honest argument rather than a
      // convenience: no conflict set was ever computed for a planless branch
      // (`conflictsKnown` is false in the `stuckState` call below, for the same
      // reason), so nothing licenses the branch arm here. A conflicting PR in
      // this loop therefore reads as `pr` — the PR is still where its checks
      // and its reviewers are, and the row says `conflicts` in its status slot
      // either way.
      kind: rowKind(branch, true, false),
      plan: ideaSlug,
      // Resolvable since the plan viewer learned to read branch plans: before
      // that this was deliberately blank, because linking to a file the route
      // would 404 on is worse than plain text. The route reads both sources
      // now, so the caution is obsolete — and leaving it in cost the grouped
      // rows their only way to open the plan.
      planFile: ideaPlans?.get(branch) ?? '',
      // NO SPRINT — and "" here is a fact, not a default reached by omission. A
      // release row and an unplanned PR belong to no sprint by their nature: they
      // are outside the question a sprint filter asks, which is exactly why the
      // filter must keep them visible. An idea branch DOES carry a plan slug, but
      // that plan is under review on its own branch and no sprint commits to a
      // plan still being drafted; `sprintOf` is built from active sprints' member
      // lists, which name landed plans, so an idea slug is absent from it anyway.
      sprint: '',
      // THE VERSION a release branch would ship, read from its own
      // `package.json` — "" on every other branch. See `releaseVersions`.
      version: versions?.get(branch) ?? '',
      wave: '',
      state: 'wip',
      // No plan, so no deferral and nothing to explain.
      deferredReason: '',
      // An idea branch CARRIES a plan still under review, and a plan under
      // review is Discovery by definition — that is what the phase means, and
      // the branch name is a convention Plot itself writes rather than a guess.
      //
      // Every other planless branch gets null. There is no plan to read a phase
      // from, and inventing one would be worse than the empty cell: `Discovery`
      // on a release branch is a confident wrong answer where nothing is the
      // honest one. Same rule as `plan: ''` two lines down.
      phase: /^idea\//.test(branch) ? 'Discovery' : null,
      group,
      ageMinutes,
      note,
      branch,
      // Encoded per path SEGMENT, matching the planned rows above: a branch
      // name always contains a slash, and encoding it whole yields `bug%2Ffix`
      // — a link that 404s on the host.
      branchUrl: urlBase
        ? `${urlBase}${branch.split('/').map(encodeURIComponent).join('/')}`
        : '',
      pr: agentPr(pr),
      waitingDays: null,
      // No local activity signals, and that is the honest answer rather than a
      // gap. This row is built from the PR map — a branch no plan names — so
      // the worktree scan never looked at it and there is nothing to forward.
      //
      // False here means UNKNOWN, never "nobody is working": by `ABSENT IS NOT
      // FALSE` the row simply carries no activity marker. Guessing one from the
      // PR's age would invent an observation this machine never made.
      localDirty: false,
      // NO WORKTREE, so no write to time. These rows reach the board from the
      // host's PR list rather than from a checkout — the same reason
      // `localDirty` is false one line up.
      changedAgo: null,
      changedAt: null,
      localLocked: false,
      // 0 here means UNOBSERVED, exactly as `false` does above — this row was
      // built from the PR map, so no worktree was ever inspected for it. The
      // unpushed mark therefore does not render, which is correct: claiming a
      // branch has nothing unpushed on the strength of never having looked is
      // the same invented observation, one field along.
      localAhead: 0,
      // A PLANLESS branch has no plan to be waiting on, and no slice to be
      // blocked by. Null is the answer rather than a value, and it is the same
      // answer `waitingOnFor` gives every row outside `not-started` — which
      // this row always is, since it reaches the board through the PR map.
      waitingOn: null,
      // NO BRIEF QUESTION TO ASK, so `unknown` — and it is the honest answer
      // here rather than a default standing in for one.
      //
      // A brief is written by `/plot-implement` FOR A BRANCH A PLAN NAMES. This
      // row reaches the board through the PR map precisely because no plan names
      // it, so there is no hand-off for a brief to be the specification of. It
      // is not `missing`: nothing is absent that anything would ever write. And
      // the renderer says nothing for `unknown`, which is what a row with no
      // brief question should show.
      brief: 'unknown',
      blockedBy: null,
      // NO SLICE, SO NO VERDICT — null, and for the same reason as the two
      // fields above rather than as a placeholder. This row is built from the PR
      // map: no plan names the branch, so there is no slice to hold a verdict
      // about it.
      //
      // Explicitly NOT the `'eligible'` handed to `classify` a few lines up.
      // That argument exists to steer the function into its PR arm, where an
      // open PR's checks decide the group — it is a routing value, not a claim
      // about a slice, and putting it on the row would state that the ordering
      // of a plan that does not exist has been satisfied.
      verdict: null,
      // NO PLAN, so no startability question — null, the same as `verdict`
      // above and for the same reason. A planless row is a branch no plan
      // names, so there is no approval to wait on, no brief to require, and no
      // slice ordering to satisfy.
      startability: null,
      // `elsewhere` — NOWHERE TO LOOK, which is the exact truth for this row
      // and not a stand-in for one. The worker pid lives in the worktree, and
      // this row was built from the PR map: the worktree scan never visited
      // this branch, so no question about a worker was asked here.
      //
      // The same reasoning as `localDirty: false` above and a stronger version
      // of it — `elsewhere` SAYS "no worktree here" rather than leaving it to
      // be inferred, which is why the state exists as a third value beside
      // `none`. Reporting `none` would be the invented observation: looking and
      // finding nothing sends a reader into this checkout, and nothing looked.
      worker: 'elsewhere',
      // No worktree was visited, so no CPU was sampled and the activity cue
      // answers nothing — "" for the same reason `worker` is `elsewhere` above.
      worker_activity: '',
      // A PLANLESS branch is not in the pulse, so no conflict set was ever
      // computed for it and `conflictsKnown` is false — which is *not looked
      // at*, never *clean*. The one state reachable from PR data alone is
      // therefore `ci-failing`, and it carries the evidence it has: the failing
      // check names and whatever history was fetched.
      //
      // Its changed paths are absent for the same reason, and absent is what
      // renders. Reporting two of three evidence lines is honest; inventing the
      // third from a diff this function has no way to run is not.
      stuck: stuckState({
        state: 'wip',
        conflicts: [],
        conflictsKnown: false,
        localAhead: 0,
        prState: prState(pr),
        failingChecks: pr.failing_checks ?? [],
        runHistory: runs?.get(branch) ?? [],
      }),
      // A planless branch can never reach `artifact-conflict` — no conflict set
      // was computed for it, so `conflictsKnown` is false two lines up and the
      // resolver was never offered it. The field is present and null rather than
      // absent: *nothing was attempted*, which is true and checkable.
      repair: repairFor(branch, now),
      // NO LOCAL PROCESS CAN BE CLAIMED HERE, and the host one is the whole of
      // what this row knows. `worker: 'elsewhere'` eleven lines up says the
      // worktree scan never visited this branch, so `machineProcesses` is given
      // that state verbatim and emits no local entry — the same rule
      // `localDirty: false` follows, one entity along. A pending check on the
      // host is still a machine working and still belongs in the section, which
      // is the entry it does produce.
      processes: machineProcesses('elsewhere', '', pr),
      // NO DESK WAS READ, so no monitor can have found anything about this
      // branch here. [] is *nothing was looked for*, which is exactly true —
      // this row is built from the PR map and no worktree was inspected for it.
      findings: [],
      // NOT A BRANCH NOBODY IS ON. Every row in this loop has an OPEN PR by the
      // filter above, so the work is up for review and the wait is somebody
      // else's — which is the one case `quietKind` itself declines to call
      // abandoned. Null is the question not being asked.
      quietKind: null,
    });
  }

  // A BRANCH CARRYING COMMITS IS WORK, whether or not anyone opened a PR for it.
  //
  // The loop above iterates PRS, and that made *has an open PR* an unstated
  // precondition for appearing at all: a branch with commits and no PR is in
  // neither collection — no plan names it, so the plan walk misses it, and no PR
  // exists, so the PR loop never reaches it. Measured 2026-08-24 against the live
  // board: 33 remote branches, 105 rows, and 8 unmerged branches with NO ROW.
  // Re-measured on main 2026-08-27: 34 unmerged, 3 with open PRs.
  //
  // The finding was not the one the question expected. FOUR OF THE SIX were
  // named by a plan — invisible *despite* being planned — so this is not
  // "plan-less work is invisible" but **work with no open PR is invisible, plan
  // or no plan**. A row keyed on *has a PR* answers "what is under review?"; the
  // board's own sections ask "what is going on?", and three commits pushed
  // yesterday on a planned branch is something going on.
  //
  // So the subject inverts: the BRANCH is the row and its PR — if any — is one
  // fact about it. That is already how planned rows work; this loop was the odd
  // one out.
  //
  // The union walked is `git branch -r --no-merged origin/<main>`, computed on
  // the scan's clock by `unmergedBranches`. A merged branch has nothing
  // outstanding and needs no row, which is the rule everywhere else here and is
  // what keeps the addition bounded by ABANDONED WORK rather than by history.
  //
  // AFTER the PR loop, never before it, and the order is load-bearing: `seen`
  // below is rebuilt from `rows` so it holds the plan rows AND the PR rows this
  // pass just added. A branch already carrying either gets no second row — one
  // branch on the board twice is a defect this sprint has already fixed four
  // times.
  const seen = new Set(rows.map((r) => r.branch));
  for (const branch of unmerged ?? []) {
    if (seen.has(branch)) continue;
    // An OPEN PR means the loop above owns this branch and declined it only
    // because a plan already had — so `seen` has caught it. Any other PR state
    // is a branch whose PR is merged or closed while its commits are not in the
    // default branch, and that IS outstanding work: the row belongs here, and
    // the PR is one fact about it rather than its reason for existing.
    const pr = prs?.get(branch) ?? null;
    if (pr && pr.state === 'OPEN') continue;
    const ageMinutes = ages.get(branch) ?? null;
    // `wip` IS THE HONEST GIT ANSWER — the branch exists and carries work — and
    // it is the state the loop above already uses for its own rows. It also lets
    // `classify` reach its arms normally rather than needing a new state nothing
    // else understands.
    //
    // No PR is handed over, and that used to mean `classify` could not reach a
    // `waiting-on-you` arm at all — every one of them required a PR record.
    // `quiet-is-not-one-state` added the arm that requires the ABSENCE of one:
    // commits, no PR ever opened, nobody on it is ABANDONED, and it is the one
    // kind of quiet that genuinely needs a person — revive it, or drop it.
    //
    // The row still lands in NOT STARTED while the commit is recent, which is
    // the half that mattered: nothing is asked of the reader by a branch
    // someone may still be writing, and the quiet window is what separates the
    // two. Past it, the row used to say *no commit for 126 days* — a duration
    // standing in for a state — and now says which state it is in.
    // THE HOST'S `MERGED` REACHES THIS ARM TOO, and it did not before. This
    // loop walks `unmergedBranches`, which asks git — and **squash-merge leaves
    // a branch permanently ahead of main**, so ancestry calls a landed branch
    // unmerged forever. Measured 2026-09-04: #610, #577 and #616 all merged on
    // 09-01 and all three sat in WAITING ON YOU reading *abandoned*, because
    // this call passed no merged fact and `quietKind` defaulted to `false`.
    //
    // `pr.state === 'MERGED'` is the explicit answer the adapter normalises,
    // and line 2018 records why nothing else will do: a merged PR reports
    // `CLOSED` through some hosts, and ancestry cannot decide it either.
    //
    // #684 threaded this through the plan-slice path and stopped there. A
    // branch of a DELIVERED plan is no longer carried as a slice, so it falls
    // here — which is exactly the population that had been merged longest.
    const prMerged = pr?.state === 'MERGED';
    const { group, note } = classify(
      'wip', 'eligible', ageMinutes, quietMinutes, null,
      // localDirty, localAhead, planPhase, worker, workerExit, workerPid,
      // localLocked, workerDirtyPaths, workerQuestion, held, localWorktree,
      // prUnknown, deferredReason — every default, spelled out because
      // `hasMergedPr` is last and the list is positional.
      false, 0, '', 'elsewhere', '', '', false, [], '', false, '', false, '',
      prMerged);
    // Asked of the same facts the group came from. `elsewhere` is what this
    // loop knows about a worker: it reaches the branch through the REFS and
    // visits no worktree, so nothing here looked for a process.
    const kind = rowQuietKind(null, 'wip', group, 'elsewhere', null, prMerged);
    rows.push({
      repo,
      // `branch` — and NOT a new `orphan` kind. `RowKindSchema` has seven kinds
      // and its docstring says adding one makes two tables a compile error until
      // both answer for it, deliberately. A branch with no PR *is* a `branch`,
      // which is exactly what that kind means.
      //
      // `false` for `hasPr` states what this row is built from rather than what
      // the host knows: this loop reaches a branch through the REFS, and a closed
      // or merged PR on it is not the row's subject. `false` for conflicts for
      // the reason the loop above gives — no conflict set was ever computed for
      // a branch outside the pulse, and *not looked at* is not *clean*.
      kind: rowKind(branch, false, false),
      // No plan names it. An idea branch is the loop above's case, not this
      // one — it carries an open draft PR by construction — so there is no slug
      // to claim here and inventing one would be worse than the empty cell.
      plan: '',
      planFile: '',
      sprint: '',
      // A release branch would be caught by the loop above through its PR. If
      // one reaches here it is a release branch nobody opened a PR for, and its
      // version is still the honest fact to show.
      version: versions?.get(branch) ?? '',
      wave: '',
      state: 'wip',
      deferredReason: '',
      // NO PLAN TO READ A PHASE FROM, so null — the same rule the loop above
      // follows for every non-idea branch. `Discovery` on a branch nobody
      // planned is a confident wrong answer where nothing is the honest one.
      phase: null,
      group,
      ageMinutes,
      note,
      branch,
      // Encoded per path SEGMENT, matching every other row: a branch name
      // contains a slash, and encoding it whole yields `bug%2Ffix` — a link that
      // 404s on the host.
      branchUrl: urlBase
        ? `${urlBase}${branch.split('/').map(encodeURIComponent).join('/')}`
        : '',
      // THE LINK ONLY, and it is why `prsByHeadMap` exists as a second map. A
      // branch here may carry a MERGED PR whose commits are not in the default
      // branch — a squash-merge into a release train, or a merge the local ref
      // predates. `prs` is open-only and drops exactly that PR, which is the one
      // a reader most wants; this map keeps its number reachable while the group
      // and the note stay decided by git alone, above.
      pr: (() => {
        const link = pr ?? prsByHeadMap?.get(branch) ?? null;
        return link ? agentPr(link) : null;
      })(),
      waitingDays: null,
      // NO WORKTREE WAS VISITED for this row — it is built from the refs, the
      // same as the PR loop above is built from the PR map. `false` and `0` mean
      // UNOBSERVED, never "nobody is working" and never "nothing unpushed": by
      // `ABSENT IS NOT FALSE` the row carries no activity marker rather than a
      // claim this machine never made.
      localDirty: false,
      changedAgo: null,
      changedAt: null,
      localLocked: false,
      localAhead: 0,
      // No plan, so no slice to be blocked by and no ordering to be waiting on —
      // the same answer `waitingOnFor` gives every row outside a plan.
      waitingOn: null,
      // A brief is written by `/plot-implement` FOR A BRANCH A PLAN NAMES, and
      // no plan names this one. Not `missing`: nothing is absent that anything
      // would ever write.
      brief: 'unknown',
      blockedBy: null,
      verdict: null,
      startability: null,
      // `elsewhere` — NOWHERE TO LOOK, which is the exact truth. This row comes
      // from a ref, so the worktree scan never visited the branch and no question
      // about a worker was asked here. Reporting `none` would be the invented
      // observation: looking and finding nothing sends a reader into this
      // checkout, and nothing looked.
      //
      // If a worker IS running on the branch, the pulse names it and the plan
      // walk builds the row — `seen` then keeps this loop off it, and the worker
      // facts move it to WORKING through the same path every other row uses.
      worker: 'elsewhere',
      worker_activity: '',
      // NOTHING THE HOST SAID AND NOTHING THE SCAN COMPUTED. No conflict set
      // exists for a branch outside the pulse, and no open PR supplies checks —
      // so `stuckState` is given a `wip` branch with nothing wrong that anyone
      // measured, and answers accordingly. That is *no evidence of stuck*, not a
      // clean bill of health, and it is the only answer the inputs license.
      stuck: stuckState({
        state: 'wip',
        conflicts: [],
        conflictsKnown: false,
        localAhead: 0,
        prState: null,
        failingChecks: [],
        runHistory: runs?.get(branch) ?? [],
      }),
      repair: repairFor(branch, now),
      // No worktree and no open PR, so neither entity this can report exists —
      // `elsewhere` says the local side was never looked at, and a null PR
      // supplies no pending check. An empty list is what both facts add up to.
      processes: machineProcesses('elsewhere', '', null),
      // NO DESK WAS READ — see the row above. This branch reached the board
      // from the ref list, not from a worktree, so nothing looked for a
      // monitor's log and [] claims nothing about one.
      findings: [],
      // ABANDONED, ONCE THE WINDOW HAS PASSED — this loop's whole population is
      // branches carrying commits with no open PR, which is the reading the
      // rule calls `abandoned`. Null while the commit is recent, because the
      // row is in NOT STARTED then and nobody has given up on anything.
      quietKind: kind,
    });
    // Guards the ONE-ROW-PER-BRANCH rule against the set itself: a duplicate ref
    // name cannot produce a second row. `unmerged` is a Set so this cannot fire
    // today, and it costs nothing to make the invariant hold locally rather than
    // depend on a caller's collection type.
    seen.add(branch);
  }

  rows.sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (g !== 0) return g;
    return compareWithinGroup(a, b);
  });
  return rows;
}

const EMPTY_SUMMARY = {
  plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
  waiting: 0, prereq_missing: 0,
  // A cold cache asked no host, so it reports no verdict — the same reasoning as
  // `partialSummary`. All-zero counters are also the healthy-fleet answer, and
  // `ready` is what separates the two; `host` must not add a second, wronger
  // claim on top of that collision.
  host: 'unknown' as const,
};

/**
 * Which active sprint lists each plan, keyed by plan SLUG → sprint slug — the
 * join the fleet row's `sprint` field is set from. Read from the sprint FILES,
 * not from any plan's `Sprint:` field: {@link collectSprints} parses the
 * `- [ ] [slug]` member lines, and that list is complete by construction where
 * the back-reference is unreliable.
 *
 * `active/` is a curated symlink index, so `collectSprints` already returns the
 * active sprints — but the phase is checked here anyway, so the map's meaning is
 * legible from the code that builds it rather than from an index invariant this
 * file does not own. A Closed sprint left linked by drift must not claim a row.
 *
 * FIRST active sprint wins where two list one plan, matching the first-wins dedup
 * the member list itself uses. Two Active sprints are permitted (two teams, one
 * train); the field records one, and the control that renders both is a later
 * slice's concern.
 */
export async function sprintMembership(opts: BuildBoardOptions): Promise<Map<string, string>> {
  // The CONFIG read is awaited; the directory walk below is not, and the split
  // is the whole of it. `workingTreeSprints` is a `readdirSync`, which is not a
  // spawn — `board.ts` says so where it is defined, and slice 1 kept it
  // synchronous deliberately. What blocked the loop here was the `bash
  // plot-config.sh` fork this line used to make.
  const sprintDir = await readConfigAsync(opts, 'Sprint directory', 'docs/sprints/');
  const map = new Map<string, string>();
  for (const sprint of workingTreeSprints(opts.repoRoot, sprintDir)) {
    if (sprint.phase !== 'Active') continue;
    for (const member of sprint.members) {
      if (!map.has(member.slug)) map.set(member.slug, sprint.slug);
    }
  }
  return map;
}

/**
 * Each Active sprint with its target release and its three exhaustive counts —
 * the payload the Agents-tab sprint control renders. One entry per Active
 * sprint, because two teams may share one train and picking the newest would
 * hide a commitment; [] where none is Active.
 *
 * The counts are a TALLY of `plan.status`, never a second computation of it:
 * {@link planStatusBySlug} returns each plan's status from the ONE `planStatus`
 * function, and this joins the sprint's member slugs against that map.
 *
 * THREE BUCKETS, NOT SEVEN STATUS VALUES:
 *
 * | bucket | PlanStatus values |
 * |---|---|
 * | open | draft, open, approved |
 * | wip | in-progress, deliverable |
 * | done | delivered |
 *
 * Every member lands in exactly one bucket, and `total = open + wip + done`.
 * The old four buckets could silently drop a Draft member (counted nowhere);
 * these three cannot — the arithmetic fails visibly when a member falls through.
 *
 * `released` is counted in `done`: the work IS done, and a released member
 * under an Active sprint is drift worth seeing in `plot-reconcile-scan.sh`
 * section 9, not a case to absorb here.
 *
 * A DEFERRED member is not counted. Its slug sits under `### Deferred` in the
 * sprint file, which `parseSprintMembers` tags `tier: 'deferred'`; those are
 * not commitments, so a count that swallowed them would overstate the sprint.
 *
 * Same source and clock as {@link sprintMembership} — one `docs/sprints/` read
 * plus one plan-meta parse per render, no host call — so a sprint file or a
 * plan edited between two scans shows on the next poll.
 */
export async function activeSprints(
  opts: BuildBoardOptions,
  pulse: FleetReading | null,
  complete: boolean,
): Promise<FleetSprint[]> {
  const sprintDir = await readConfigAsync(opts, 'Sprint directory', 'docs/sprints/');
  const active = workingTreeSprints(opts.repoRoot, sprintDir).filter((s) => s.phase === 'Active');
  if (active.length === 0) return [];
  const statusBySlug = await planStatusBySlug(opts, pulse, complete);
  return active.map((sprint) => {
    const counts = { total: 0, open: 0, wip: 0, done: 0 };
    for (const member of sprint.members) {
      if (member.tier === 'deferred') continue;
      const status = statusBySlug.get(member.slug);
      switch (status) {
        // Open: committed, not started
        case 'draft':
        case 'open':
        case 'approved':
          counts.open += 1;
          break;
        // WIP: started, not delivered
        case 'in-progress':
        case 'deliverable':
          counts.wip += 1;
          break;
        // Done: delivered (or released, treated as done)
        case 'delivered':
        case 'released':
          counts.done += 1;
          break;
        // Unknown slug (renamed/deleted plan): not counted. The member list
        // still carries it, so it remains visible; the count does not claim
        // progress on a plan that cannot be found.
        default:
          continue;
      }
      counts.total += 1;
    }
    // Invariant: total === open + wip + done. The plan requires this, and
    // keeping it true by construction is simpler than asserting it.
    return { slug: sprint.slug, title: sprint.title, release: sprint.release, counts, members: sprint.members };
  });
}

/**
 * Estate-wide counts over ALL plans — the same three buckets the sprint counts
 * use. Shown in the sprint control when the filter is OFF, so a reader sees the
 * effect of turning it on: "21 members" versus "112 plans".
 *
 * Uses the SAME `planStatusBySlug` map as {@link activeSprints}, so the two
 * derivations cannot disagree about what a bucket means — one map, two
 * aggregation scopes. Calling `planStatusBySlug` twice is acceptable: it runs on
 * the render clock, reads only working-tree plans, and caches nothing internally,
 * so a second call on the same tick is just a repeated function call, not a
 * redundant scan.
 *
 * The returned counts carry `total`, `open`, `wip`, `done` exactly as
 * {@link SprintCountsSchema} specifies, and the invariant `total = open + wip +
 * done` is maintained by construction.
 */
export async function estateTotals(
  opts: BuildBoardOptions,
  pulse: FleetReading | null,
  complete: boolean,
): Promise<SprintCounts> {
  const statusBySlug = await planStatusBySlug(opts, pulse, complete);
  const counts: SprintCounts = { total: 0, open: 0, wip: 0, done: 0 };
  for (const status of statusBySlug.values()) {
    switch (status) {
      // Open: committed, not started
      case 'draft':
      case 'open':
      case 'approved':
        counts.open += 1;
        break;
      // WIP: started, not delivered
      case 'in-progress':
      case 'deliverable':
        counts.wip += 1;
        break;
      // Done: delivered (the Testing column)
      case 'delivered':
      case 'released':
        counts.done += 1;
        break;
      // Unknown status: not counted, same as activeSprints
      default:
        continue;
    }
    counts.total += 1;
  }
  return counts;
}

/**
 * Read the cached pulse. Never runs the scan — that is the whole point.
 * `repoRoot` stays a parameter even while the UI shows one repo, so the second
 * one is an addition rather than a rebuild.
 */
export async function buildFleet(
  opts: BuildBoardOptions,
  quietMinutes = DEFAULT_QUIET_MINUTES,
): Promise<Fleet> {
  const entry = ensureCache(opts);
  const repo = path.basename(opts.repoRoot);
  const now = Date.now();
  const ageSeconds = entry.at === null ? 0 : Math.round((now - entry.at) / 1000);
  // THE FIVE READS, ASKED TOGETHER and hoisted above the literal. The two
  // plan-status reads go through `planStatusBySlug`, which reads the plan estate
  // from the ref — an await, where until 2026-08-31 it was a synchronous spawn.
  // The other two became awaits on 2026-09-01 for the same reason: the main
  // checkout's branch now comes from the worktree listing through the `Trees`
  // port, and the sprint membership reads its directory from the config through
  // `plot-config.sh` off the loop. Awaiting them in sequence would serialise
  // five independent reads for nothing; they are asked concurrently and the
  // object below stays a literal.
  //
  // The fleet controls join them for the same reason. `readFleetSettings` seeds
  // its defaults from three `## Plot Config` keys, unconditionally, so the pulse
  // paid three synchronous forks per render whether or not a state file existed
  // to override them.
  const [sprints, totals, masterAgentBranch, membership, settings] = await Promise.all([
    activeSprints(opts, entry.pulse, entry.pulseComplete),
    estateTotals(opts, entry.pulse, entry.pulseComplete),
    readMasterAgentBranch(opts),
    sprintMembership(opts),
    readFleetSettings(opts),
  ]);
  const rows = entry.pulse
    ? rowsFromPulse(entry.pulse, entry.ages, repo, quietMinutes, entry.prs,
      entry.branchUrlBase, entry.approvedAt, now, entry.ideaPlans, entry.versions,
      entry.runs,
      // The root, so each row can be asked whether its brief exists. Read HERE
      // on the render clock rather than carried on the pulse: the check is one
      // `existsSync` and a brief written between two scans is visible on the
      // next pulse, where a scan-time answer would be as stale as the scan.
      entry.questions, entry.prsByHead, opts.repoRoot,
      // Which active sprint claims each plan — read on the render clock like the
      // brief above, and for the same reason: a sprint file edited between two
      // scans shows up on the next pulse. One dir read per pulse, no host call.
      // Awaited above rather than here, because `rowsFromPulse` is synchronous
      // and a Promise handed to it would read as a Map that holds nothing.
      membership,
      // WHICH BRANCHES STILL CARRY WORK. From the cache rather than read here:
      // this is a git question and the render path is synchronous, the same rule
      // the ages and versions above follow.
      entry.unmerged)
    : [];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds,
    // WHICH WORLD this answer is about, beside how old it is.
    //
    // `read_ref` is read when the scan sends it and NOT substituted when it does
    // not. An older scan emits only `head`, which is `git rev-parse HEAD` — the
    // local checkout, not the ref the scan read. Falling back to it here would
    // manufacture the exact false statement this field exists to prevent, and
    // would do it silently, on every consumer, until the scan caught up. Null
    // says "the scan did not tell me"; that is the honest answer and a consumer
    // can act on it.
    readRef: entry.pulse?.read_ref ?? null,
    // Dated by the scan that produced it, not by a clock of its own: the ref and
    // its age come off one cached pulse, so they cannot disagree. Null rather
    // than 0 when nothing has been read — 0 would assert a read that just
    // happened, which is the confident-absent-value shape this file rejects.
    readRefAge: entry.at === null ? null : ageSeconds,
    // `head` IS the local head — that is all it has ever carried, under a name
    // that implied more. So the fallback runs in this direction only: prefer the
    // scan's explicit `local_head`, else the legacy field that means the same
    // thing. Neither can mislead, because both are the same fact.
    localHead: entry.pulse?.local_head ?? entry.pulse?.head ?? null,
    ready: entry.pulse !== null,
    // Whether the pulse this answer is built from is every plan the scan found.
    // A cold cache reports `ready: false` and `complete: true` — nothing has
    // arrived, and nothing is outstanding either, which is the honest pair: the
    // partial state is *rows exist and more are coming*, and no rows exist yet.
    complete: entry.pulseComplete,
    error: entry.error,
    shrink: entry.shrink,
    rows,
    // THE SLICES, derived once from the same pulse the rows came from — beside
    // `rows`, not left for the client to re-group. Emitted unconditionally: []
    // on a cold cache, because the client CASTS this payload and a Zod
    // `.default([])` never fires client-side. A field the server left off would
    // reach the renderer as `undefined`, the `fleetControls` lesson from
    // 2026-08-22.
    slices: entry.pulse ? deriveSlices(entry.pulse) : [],
    summary: entry.pulse?.summary ?? EMPTY_SUMMARY,
    // COUNTED FROM THE ROWS, never tallied beside the decision that made them.
    // A counter incremented in parallel with a classification is a second
    // implementation of it, and the two drift the first time a state is added.
    stuck: summarizeStuck(rows.map((r) => r.stuck)),
    prAgeSeconds: entry.prAt === null ? null : Math.round((now - entry.prAt) / 1000),
    // The server's own intention, backoff included — never the nominal 60 s.
    // `prNextAt` is the single gate the fetch obeys, so reporting it is
    // reporting the truth rather than a second copy of the cadence that could
    // drift from it. Clamped at 0 because a due-but-not-yet-fired fetch is "any
    // moment now", and a negative countdown is nothing at all.
    prNextInSeconds: Math.max(0, Math.round((entry.prNextAt - now) / 1000)),
    // Same reasoning one interval down: the scan is a fixed-rate timer that
    // stamps `entry.at` when it lands, so the next one is due REFRESH_MS after
    // that. The client cannot derive this — its own poll runs at a different
    // rate, and subtracting one clock's age from the other's interval is what
    // pinned the countdown at zero. Null before the first scan, since "due in
    // 5 s" would be a guess about a scan that has not happened.
    scanNextInSeconds:
      entry.at === null ? null : Math.max(0, Math.round((entry.at + REFRESH_MS - now) / 1000)),
    prError: entry.prError,
    // HOW MANY SPENDERS THE RECORD ACCOUNTS FOR, computed here because this is
    // where both halves of the quotient live: the observed rate the cadence
    // already read, and the backend that decides what one refresh costs. A
    // client dividing for itself would need `PR_REFRESH_MS` and the cost table,
    // and would hold a second copy of arithmetic that must agree with the
    // cadence's.
    //
    // Null where the record could not be read — the banner then names the limit
    // and invents no population.
    prSpenders: localSpenders(
      entry.prSpendPerHour === null ? null : { perHour: entry.prSpendPerHour },
      PR_REFRESH_MS,
      prRequestsPerRefresh(entry.backend ?? 'github'),
    ),
    // THE CAP AND WHAT IS AGAINST IT, so the bound is visible rather than
    // merely quiet. Both null before the first refresh has read a limit, which
    // is *unbounded* rather than *zero*.
    prConcurrencyCap: prConcurrencyBound(entry),
    prSlotsHeld: entry.prSlotsHeld,
    // The inbox travels with its ANSWER, never alone: a consumer reading
    // `issues: []` without `issueAnswer` cannot tell an empty tracker from one
    // that was never reachable, and would render the second as the first.
    issues: entry.issues,
    issueAnswer: entry.issueAnswer,
    // Beside `rows`, never derived from them: a row is a branch that mentions an
    // agent, this is an agent that mentions a branch. A running worker appears
    // in both and is not duplicated — the entities differ.
    agents: entry.agents,
    // Metadata about the registry read — directory, manifest count, synthesized
    // count. Makes a synthesized fleet legible: a reader seeing `0 manifests,
    // 12 synthesized` knows the drop menu is absent because the board is reading
    // an empty directory, not because nothing is broken.
    registry: entry.registry,
    issueError: entry.issueError,
    // The two fleet controls, read fresh from `.plot/state/` on this render
    // clock — NOT off the cached pulse — so a write through /api/fleet-controls
    // is visible on the very next poll. Read here, unconditionally, because the
    // client casts this payload rather than parsing it: a Zod `.default` never
    // fires client-side, so a field the server left off would reach the renderer
    // as `undefined`. It is emitted every time, cold cache included.
    //
    // `working` IS THE COUNT OF LIVE ENTRIES — exactly what WORKING renders.
    // The client produces one row per LIVE `agents` entry (`workingAgentRows`
    // filters on `isLiveState`), so the count applies the SAME predicate here:
    // one rule read twice, never two derivations that can disagree — the
    // property #403 established, preserved through the `working-lists-the-live-
    // agents` filter rather than undone by it. A registry entry for a session
    // that has ended (`stalled`, `finished`, `unknown`) is not a worker and is
    // not counted. It still does not depend on the pulse: the registry is read
    // from disk on every refresh, and absence means no dispatch has run — a
    // fact, not an unreachable host.
    fleetControls: {
      ...settings,
      working: entry.agents.filter((a) => isLiveState(a.state)).length,
    },
    // The Active sprints, each with release and four `status` counts, aggregated
    // on THIS render clock from the same cached pulse the rows came from — so a
    // sprint file or a plan status edited between two scans shows on the next
    // poll. Emitted unconditionally (a cold cache passes `null`, which yields the
    // plan-only counts) because the client casts this payload and a Zod
    // `.default([])` never fires client-side.
    sprints,
    // Estate-wide counts over ALL plans, the same three buckets the sprint
    // counts use. Shown in the sprint control when the filter is OFF, so a
    // reader sees the effect of turning it on: "21 members" versus "112 plans".
    // Computed on the render clock for the same reason as `sprints`: a plan
    // whose status just moved shows on the next poll.
    estateTotals: totals,
    // The MAIN CHECKOUT's branch, read on the render clock with a TTL cache.
    // Not `server.branch`, which is the worktree the board server started in.
    // This is where the operator works — the first entry of `git worktree list`.
    // Emitted unconditionally ('', which means "show nothing", on any failure)
    // because the client casts this payload and a Zod `.default('')` never
    // fires client-side.
    masterAgentBranch,
    // The prefix for constructing the master agent row's branch URL. The
    // server already computes `branchUrl` for each row; this row is assembled
    // client-side, so the prefix must travel with it. Empty for any host the
    // board does not recognise — and empty renders as plain text.
    branchUrlBase: entry.branchUrlBase,
  };
}
