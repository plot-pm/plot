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
  toBoardPhase,
  unknownPhaseNote,
  WaveVerdictSchema,
  type AgentRow,
  type BranchState,
  type Fleet,
  type FleetPulse,
  type IssueAnswer,
  type IssueRow,
  type MachineProcess,
  type Phase,
  type PulseShrink,
  type RowKind,
  type StuckRun,
  type WaitingGroup,
  type WaitingOn,
  type WaveVerdict,
  type WorkerState,
} from '../contract/schema.js';
import { stuckState, summarizeStuck } from './stuck.js';
import { repairFor, startRepair } from './resolver.js';
import type { BuildBoardOptions } from './board.js';
import { readBridge, writeBridge } from './pulse-bridge.js';
import { workerQuestions } from './worker-question.js';

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
 * What ONE PR refresh costs, in host requests, on each backend.
 *
 * The number the cadence above was missing. `PR_REFRESH_MS` reasons about a
 * refresh as a unit — "60 s between refreshes" — and that reasoning is only
 * about spending if a refresh is one request. On GitHub it is. On Bitbucket it
 * is three, and the adapter has known that all along while the board did not:
 * `plot-host.sh` expands `--state all` into `open`, `merged` and `declined`
 * because `bb` has no `all` state, so the one call this file makes fans out
 * into three round trips before it returns.
 *
 * Measured against `bitbucket.org/quatico/ekzweb` (issue #226), 60 s cadence:
 *
 *     GitHub      1 request  x 60 refreshes =  60 requests / hour
 *     Bitbucket   3 requests x 60 refreshes = 180 requests / hour
 *
 * A board left open a working day made ~1400 Bitbucket requests just watching,
 * and reached `HTTP 429 — Rate limit for this resource has been exceeded`
 * account-wide, with every `bb` call from the operator's own shell failing too.
 *
 * ONLY `pr-list` is counted, and that is not an omission. The refresh also runs
 * `issue-list` and `runs`, and on Bitbucket both cost ZERO requests: `bb`
 * exposes no issue listing (`plot-host.sh` exits 4 before touching the network)
 * and no run listing (the Bitbucket arm is empty). So on the host this branch
 * exists for, `pr-list` is the whole bill — counting the calls that cannot be
 * made would overstate it and slow the board down for requests nobody sends.
 *
 * A backend absent from this table costs 1 — the naive assumption, kept as the
 * default so a host added later behaves exactly as every host did before, and
 * is slowed only once someone measures what it really costs.
 */
const PR_REQUESTS_PER_REFRESH: Record<string, number> = {
  // One `gh pr list --state all` call, whatever the states asked for.
  github: 1,
  // `bb` has no `all` state, so `--state all` is three calls: open, merged,
  // declined. Do not "fix" this by inventing an `all` — it would fabricate an
  // answer the host cannot give. This branch makes the cadence aware of the
  // cost; removing the cost is not available.
  bitbucket: 3,
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
const PR_LIMIT = 300;

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

interface CacheEntry {
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
  pulse: FleetPulse | null;
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
  timer: NodeJS.Timeout | null;
  prTimer: NodeJS.Timeout | null;
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
 * so a scan that emits a plan twice cannot double a card's wave count.
 */
export function mergePlan(plans: FleetPulse['plans'], plan: FleetPulse['plans'][number]): FleetPulse['plans'] {
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
 * `blocked` and `deferred` are counted the same way the scan counts them, which
 * is the one duplication this function accepts — see the note on `summarizeStuck`
 * for why counting FROM the rows beats tallying beside them: a partial pulse has
 * no other source, and deriving it here means it cannot disagree with the plans
 * it is derived from.
 */
export function partialSummary(plans: FleetPulse['plans']): FleetPulse['summary'] {
  let waves = 0, branches = 0, claimed = 0, eligible = 0, blocked = 0, deferred = 0;
  for (const plan of plans) {
    for (const wave of plan.waves) {
      waves += 1;
      if (wave.verdict === 'blocked') blocked += 1;
      for (const b of wave.branches) {
        branches += 1;
        if (b.state === 'deferred') deferred += 1;
        else if (b.state === 'claimed') claimed += 1;
        else if (b.state === 'open' && wave.verdict === 'eligible') eligible += 1;
      }
    }
  }
  return { plans: plans.length, waves, branches, claimed, eligible, blocked, deferred };
}

/** Every branch name in a pulse, across all plans and waves. */
function branchNames(pulse: FleetPulse): Set<string> {
  const names = new Set<string>();
  for (const plan of pulse.plans) {
    for (const wave of plan.waves) {
      for (const b of wave.branches) names.add(b.branch);
    }
  }
  return names;
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
export function pulseShrink(
  previous: FleetPulse | null,
  incoming: FleetPulse,
  previousAt: number | null,
): PulseShrink | null {
  // Nothing to compare against is not a shrink. The first scan of a process —
  // and the first after a bridge miss — legitimately arrives with no
  // predecessor, and calling that a loss would flag every cold start.
  if (previous === null || previousAt === null) return null;

  const wasPlans = new Set(previous.plans.map((p) => p.file));
  const nowPlans = new Set(incoming.plans.map((p) => p.file));
  const lostPlans = [...wasPlans].filter((f) => !nowPlans.has(f));

  const wasBranches = branchNames(previous);
  const nowBranches = branchNames(incoming);
  const lostBranches = [...wasBranches].filter((b) => !nowBranches.has(b));

  if (lostPlans.length === 0 && lostBranches.length === 0) return null;
  // Sorted so the same loss renders identically on every poll: the sets are
  // built from iteration order, and a message that reshuffles itself while the
  // condition holds steady reads as new information arriving.
  return {
    plans: lostPlans.sort(),
    branches: lostBranches.sort(),
    previousAt,
  };
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

async function approvalDates(
  opts: BuildBoardOptions,
  pulse: FleetPulse,
): Promise<Map<string, number>> {
  const dates = new Map<string, number>();
  if (pulse.plans.length === 0) return dates;
  const planDir = await planDirectory(opts);
  const files = pulse.plans.map((p) => path.join(opts.repoRoot, planDir, p.file));
  try {
    const out = await run('bash',
      [path.join(opts.scriptsDir, 'plot-plan-meta.sh'), ...files], opts.repoRoot);
    for (const line of out.split('\n')) {
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
    const out = await run('bash',
      [path.join(opts.scriptsDir, 'plot-config.sh'), 'get', 'Plan directory', 'docs/plans/'],
      opts.repoRoot);
    return out.trim() || 'docs/plans/';
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
 * Parse `gh api rate_limit`'s payload into "ms from now until the GraphQL budget
 * resets", or null when it cannot be read.
 *
 * GraphQL because that is the budget `gh pr list` spends and the one that fails
 * the PR fetch; the endpoint reports every resource's reset, and picking the
 * wrong one would wait for a budget that was never exhausted. The reset is
 * epoch SECONDS — GitHub states it in the same unit the message's stamp uses.
 *
 * Null, never a throw, on every unhappy shape: malformed JSON (an auth error
 * page, an empty string), a payload missing the GraphQL resource, a reset
 * already in the past. Each means "the host did not give us a usable reset", and
 * the caller answers that with the ceiling — the same last resort a bare message
 * had before this existed.
 */
export function graphqlResetMs(payload: string, now = Date.now()): number | null {
  let reset: unknown;
  try {
    reset = (JSON.parse(payload) as { resources?: { graphql?: { reset?: unknown } } })
      ?.resources?.graphql?.reset;
  } catch {
    return null;
  }
  if (typeof reset !== 'number') return null;
  const ms = reset * 1000 - now;
  return ms > 0 ? ms : null;
}

/**
 * The I/O half of the reset read: shell `gh api rate_limit` and hand its stdout
 * to {@link graphqlResetMs}. Returns null on any failure — `gh` absent, not
 * authenticated, or the rate-limit endpoint itself refusing — so the backoff
 * decision falls back to the ceiling rather than propagating an error out of a
 * catch block that is already handling one.
 *
 * GitHub only. `bb` has no equivalent free reset endpoint, and the design holds
 * Bitbucket untouched; the caller passes this fetcher only when the backend is
 * `github`, so this is never reached on a Bitbucket board.
 */
async function fetchGraphqlResetMs(cwd: string): Promise<number | null> {
  try {
    return graphqlResetMs(await run('gh', ['api', 'rate_limit'], cwd));
  } catch {
    return null;
  }
}

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
 *     bitbucket   60_000 x 3 = 180_000 ms  ->  20 refreshes,  60 requests / hour
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
 * to three minutes old instead of one. That is the right side to err on for
 * data whose events are minutes-scale anyway — and the alternative is not a
 * fresher board but a rate-limited one, which is how this was measured.
 */
export function prRefreshMsFor(backend: string): number {
  return PR_REFRESH_MS * prRequestsPerRefresh(backend);
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
 */
export function prNextDueAt(
  startedAt: number, backoff: number | null, now = Date.now(),
  backend = 'github',
): { at: number; hard: boolean } {
  // BEFORE the cost is applied, and this ordering is the rule the brief names:
  // a cost-aware cadence may only ever be MORE conservative than a backoff,
  // never less. The host named this floor; stretching it would be conservative
  // and harmless, but shortening it would spend quota to be refused — so the
  // backoff is returned untouched and the multiplier never reaches it.
  if (backoff !== null) return { at: now + backoff, hard: true };
  return { at: startedAt + prRefreshMsFor(backend), hard: false };
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
async function refreshRuns(
  opts: BuildBoardOptions,
  entry: CacheEntry,
  prs: Map<string, PrRecord>,
): Promise<void> {
  const runs = new Map<string, StuckRun[]>();
  const failing = [...prs.entries()]
    .filter(([, pr]) => pr.checks === 'failing')
    .slice(0, RUN_FETCH_MAX);
  for (const [branch] of failing) {
    try {
      const out = await run('bash',
        [path.join(opts.scriptsDir, 'plot-host.sh'), 'runs', branch,
          '--limit', String(RUN_HISTORY_LIMIT)],
        opts.repoRoot);
      const list: StuckRun[] = [];
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as Partial<StuckRun>;
        list.push({
          workflow: r.workflow ?? '',
          conclusion: r.conclusion ?? '',
          startedAt: r.startedAt ?? '',
          url: r.url ?? '',
        });
      }
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
    const out = await run('bash',
      [path.join(opts.scriptsDir, 'plot-plan-meta.sh'), ...files], opts.repoRoot);
    for (const line of out.split('\n')) {
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
 * THE THREE OUTCOMES STAY APART, and this function is where the adapter's exit
 * codes become them: 4 is `unsupported` (bb has no issue listing), any other
 * failure is `failed`, and only a clean exit yields `answered`. A failed lookup
 * KEEPS the last good list, the same rule `refreshPrs` follows — a row vanishing
 * on a fetch error looks like someone planned the issue.
 */
export async function refreshIssues(opts: BuildBoardOptions, entry: CacheEntry): Promise<void> {
  let raw: string;
  try {
    raw = await run('bash',
      [path.join(opts.scriptsDir, 'plot-host.sh'), 'issue-list', '--limit', String(ISSUE_LIMIT)],
      opts.repoRoot);
  } catch (err) {
    // Exit 4 is the adapter saying THIS HOST CANNOT BE ASKED — a standing fact
    // about Bitbucket, not an outage. It clears any stale error and empties the
    // list, because there is nothing to keep and nothing failed.
    const code = (err as { code?: number | string }).code;
    if (code === 4) {
      entry.issues = [];
      entry.issueAnswer = 'unsupported';
      entry.issueError = null;
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
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
    const backoff = await rateLimitBackoffMs(message);
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
async function resolveBackend(opts: BuildBoardOptions, entry: CacheEntry): Promise<string> {
  if (entry.backend !== null) return entry.backend;
  try {
    const out = await run('bash',
      [path.join(opts.scriptsDir, 'plot-host.sh'), 'backend'], opts.repoRoot);
    const be = out.trim();
    entry.backend = be || 'github';
  } catch {
    entry.backend = 'github';
  }
  return entry.backend;
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
  const backend = await resolveBackend(opts, entry);
  try {
    const out = await run('bash',
      [path.join(opts.scriptsDir, 'plot-host.sh'), 'pr-list', '--rich',
        '--state', 'all', '--limit', String(PR_LIMIT)],
      opts.repoRoot);
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
    entry.prs = map;
    entry.prsByNumber = byNumber;
    entry.prsByHead = byHead;
    await refreshRuns(opts, entry, map);
    entry.prAt = Date.now();
    const due = prNextDueAt(startedAt, null, Date.now(), backend);
    entry.prNextAt = due.at;
    entry.prNextIsBackoff = due.hard;
    entry.prError = null;
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
    const resetReader = backend === 'github'
      ? () => fetchGraphqlResetMs(opts.repoRoot)
      : undefined;
    const backoff = await rateLimitBackoffMs(message, Date.now(), resetReader);
    // A backoff is measured from NOW — the host's "wait 90 seconds" starts when
    // it said so, not when we started asking. An ordinary failure rejoins the
    // ordinary cadence, so it anchors to the start like a success does; a
    // failed call should not push the next attempt out by its own duration.
    const due = prNextDueAt(startedAt, backoff, Date.now(), backend);
    entry.prNextAt = due.at;
    entry.prNextIsBackoff = due.hard;
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
 * **This function classifies NOTHING.** It calls `stuckState` — wave 1's
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
  pulse: FleetPulse,
  prs: Map<string, PrRecord> | null,
): void {
  for (const plan of pulse.plans) {
    for (const wave of plan.waves) {
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
    let parsed: FleetPulse | null = null;
    // What has arrived THIS scan, accumulated apart from `entry.pulse`.
    //
    // Starts empty rather than from the last pulse, because a plan that has
    // vanished from the scan must be able to disappear — seeding from the
    // previous answer would make deletion impossible and turn the cache into a
    // record. It is COMPOSED with the previous pulse on each write (see
    // `renderable`), which is what lets rows stay on screen meanwhile.
    let arrived: FleetPulse['plans'] = [];
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
    await runStreaming('bash',
      [path.join(opts.scriptsDir, 'plot-fleet-scan.sh'), '--stream'], opts.repoRoot,
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
        parsed = msg.pulse;
      },
      // THE BUDGET IS SET FROM MEASUREMENT, and the measurement moved.
      //
      // 30 s was right when the scan was ~10 s. After #262 batched the
      // per-plan reads it is 34-52 s on this repo — 84 s before that change —
      // and the spread is the machine rather than the code: measured
      // 2026-08-20 with 12 worktrees and a load average of 8.35, a BARE `git`
      // spawn cost 63 ms against 31 ms on a quiet machine, and the same
      // `rev-list` timed 14 ms, 85 ms and 111 ms on three consecutive runs.
      // 203 spawns at 63 ms is ~13 s of process launch before any work.
      //
      // So a fixed budget below the loaded cost fails INTERMITTENTLY, which is
      // the worst shape: 60 correct rows arrived and the pulse was killed
      // before its terminal line, so `pulseComplete` stayed false, the banner
      // never cleared, and the footer read `60 branches across 20 plans SO
      // FAR` — accurate, and indistinguishable from a broken board.
      //
      // 90 s is HEADROOM over a 34-52 s cost, not cover for a 279 s one. It was
      // refused twice while the scan was 279 s, because a budget raised to fit
      // a 9x overrun hides the next regression instead of reporting it. The
      // remaining per-branch `rev-list` block (64 calls) is the next thing to
      // batch, and when it lands this can come back down.
      90_000,
      {
        // The map this pulse starts from. `''` on the first pulse after a
        // restart, which is what makes a restart re-derive everything.
        env: { PLOT_TERMINAL_CACHE: entry.terminal },
        onErrLine: (line) => {
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
    const complete: FleetPulse = parsed;
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
    questions: new Map(),
    // `unsupported` before the first lookup, never `answered`: a board that
    // has not asked must not render an empty inbox as a clear one.
    issues: [], issueAnswer: 'unsupported', issueError: null,
    prs: null, prsByNumber: null, prsByHead: null, runs: new Map(), prAt: null, prError: null,
    // 0, so the first fetch happens immediately rather than a minute in.
    prNextAt: 0, prNextIsBackoff: false,
    // Null, never 'github': "not yet asked" and "asked, and it is GitHub" are
    // different answers, and `resolveBackend` distinguishes them to ask once.
    backend: null,
    pulseComplete: true,
    timer: null, prTimer: null, running: false, prRunning: false,
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
  entry.timer = setInterval(() => void refresh(opts, entry!), REFRESH_MS);
  entry.timer.unref?.();
  // Its own timer, because its own clock: git is local and free at 5 s, the
  // host is metered and pointless below a minute. They failed independently
  // already; now they also fire independently.
  entry.prTimer = setInterval(() => void maybeRefreshPrs(opts, entry!), PR_REFRESH_MS);
  entry.prTimer.unref?.();
  return entry;
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
export function pulseFor(opts: BuildBoardOptions): FleetPulse | null {
  return ensureCache(opts).pulse;
}

/** Stop the refresh timers. Tests need this; the server never calls it. */
export function stopFleetRefresh(): void {
  for (const entry of caches.values()) {
    if (entry.timer) clearInterval(entry.timer);
    if (entry.prTimer) clearInterval(entry.prTimer);
  }
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
export function rowPhase(planPhase: string, state: BranchState): Phase | null {
  // A branch handed back returns to the plan's own phase, ignoring whatever its
  // commits say — the one place intent outranks git. `toBoardPhase(_, false)`
  // reads the plan's phase straight through, which is exactly "back to where it
  // is decided whether this is wanted". (With the Design fork gone the `false`
  // no longer changes the answer, but the intent is preserved for the day a
  // phase forks on `started` again.)
  if (state === 'deferred') return toBoardPhase(planPhase, false);
  // The `started` flag is read from THIS branch, not from the plan's own
  // `Started:` count — a row is a statement about one branch. It no longer
  // moves an approved plan (approved is Development regardless), but it still
  // feeds the one mapping so the row and the board card cannot disagree, and it
  // is the seam a future `started`-forking phase would use.
  //
  // `merged` counts as started, `wip` counts; `claimed` does NOT — an empty
  // claim marker is a dispatcher taking the branch, not an agent having built
  // anything.
  return toBoardPhase(planPhase, state === 'wip' || state === 'merged');
}

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
 * The order is the same as `classify`'s and that is deliberate: an earlier wave
 * outranks a Draft plan, because both are true of a Draft plan's later waves
 * and the wave is the more specific statement. Saying the weaker of two true
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
 * The question a live worker's row needs answered, and it is narrower than
 * "is the PR fine": `green` and `pending` are states in which nobody is
 * blocked — the checks passed, or a machine is still running them. Everything
 * else in the enum is somebody's errand: `conflicts` wants a rebase, `failing`
 * wants a look, `none` wants a click, `unknown` wants asking again.
 *
 * An ALLOWLIST, deliberately, and the same shape `prState` itself uses: a
 * blocklist of errand-states would silently start claiming "nobody is blocked"
 * the first time a new state is added, which is the direction that goes quiet
 * rather than loud.
 *
 * A DRAFT never qualifies. A draft is still its author's, and here the author
 * is the agent — so a green draft with a live worker is the clearest WORKING
 * row there is, and must not be diverted by this predicate's caller.
 */
export function prAsksNobody(pr: PrRecord): boolean {
  if (pr.draft) return true;
  const s = prState(pr);
  return s === 'green' || s === 'pending';
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
  // So the answer is UNCHANGED and its scope is narrower: every row still
  // reaching here belongs to a plan that can move — `approved` or `draft` — and
  // for those the hand-back is real. Somebody shelved this branch and somebody
  // may un-shelve it, which is a person, with no clock running. The note beside
  // the colour says which action.
  if (state === 'deferred') return 'you';
  if (state !== 'open') return null;
  // An earlier wave, WITHIN an approved plan — which is now the only kind of
  // plan whose open branches reach this section at all.
  if (verdict !== 'eligible') return 'time';
  // THE DRAFT ARM IS GONE, and its absence is the point rather than an
  // oversight. It used to answer `you` for a Draft plan's first wave, because a
  // Draft plan's branches sat in NOT STARTED and needed a colour saying they
  // could not be taken. They no longer sit here: `classify` sends the whole
  // plan to WAITING ON YOU, so the guard above returns null before this line
  // could run.
  //
  // Deleted rather than left unreachable. A dead arm here is a SECOND rule
  // asserting that Draft rows belong in this section — the drift this function
  // exists to prevent, and the reason it derives from `group` rather than
  // re-deciding it. The concern the old arm answered is answered better by the
  // move: a four-wave Draft plan no longer puts four loud rows on the board for
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
 * The wave verdict as a VALUE, or null where the scan did not report one this
 * board recognises.
 *
 * `classify` takes `verdict` as a `string` — it is a field off a JSON pulse, and
 * an older or newer scan may put anything in it — so the row's typed field needs
 * this one gate between the two. Parsed rather than cast: a cast would put an
 * unrecognised word on the row as though the scan had said it.
 *
 * NULL FOR EVERYTHING ELSE, including "". Absent is not a guess, which is the
 * rule `planPhase` already follows a few dozen lines below: a pulse that
 * reported no verdict licenses no claim about a wave, and a row with null here
 * renders exactly as the board did before the field existed.
 */
export function waveVerdict(verdict: string): WaveVerdict | null {
  const parsed = WaveVerdictSchema.safeParse(verdict);
  return parsed.success ? parsed.data : null;
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
   * `FleetBranchSchema.local_dirty`. Used for exactly one thing, below: to LIFT
   * a branch out of quiet. It may never downgrade an answer, because it is true
   * only on the machine doing the looking, and false is what every branch
   * elsewhere reports.
   */
  localDirty = false,
  /**
   * Commits the local branch has that the remote does not — see
   * `FleetBranchSchema.local_ahead`. Same single use as `localDirty`: it LIFTS a
   * branch out of quiet and may never downgrade an answer, because it is true
   * only on the machine doing the looking and 0 is what every branch elsewhere
   * reports.
   */
  localAhead = 0,
  /**
   * The PLAN's own lifecycle phase, verbatim from `plot-plan-meta.sh` — see
   * `FleetPlanSchema.phase`. Used for exactly one thing, below: to stop a
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
   * `FleetBranchSchema.worker`. Six values, and each names a different move.
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
   * `FleetBranchSchema.worker_exit`. Shown beside `failed` so the row names how
   * the worker died rather than only that it did.
   */
  workerExit = '',
  /**
   * The worker's pid as the SCAN read it, or "" — see
   * `FleetBranchSchema.worker_pid`. Shown beside `running` so the reader can go
   * look at the process rather than take the row's word for it.
   *
   * Never re-derived from here. `kill -0 0` signals the whole process group and
   * succeeds, so a pid of `0` checked on this side reads as running forever; the
   * scan rejects it and reports `none`, and this value only ever renders.
   */
  workerPid = '',
  /**
   * A local worktree for this branch is holding `.git/index.lock` — see
   * `FleetBranchSchema.local_locked`. A write is in progress at this instant,
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
   * `FleetBranchSchema.worker_dirty_paths`. Named in the note so the row
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
   * has not merged. See `FleetBranchSchema.held`.
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
): { group: WaitingGroup; note: string } {
  // A deferred branch is never `working` — the group is about the claim the row
  // makes, not about the age of its last commit, so a fresh commit does not
  // pull it in. Work somebody gave up is not work in progress.
  //
  // WHICH section it lands in is decided inside, and by the plan's phase before
  // anything else. See there.
  if (state === 'deferred') {
    // THE PHASE ANSWERS FIRST HERE TOO, and that is the whole of wave 2.
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
    // the shelf is part of its history. `draft` keeps the old answer for the
    // same reason it does in the `open` arm: a plan under review is not finished,
    // and a shelved branch of one waits on a person twice over.
    //
    // ABOVE the three exits below rather than beside one of them. A shelved
    // branch of a shipped plan is finished whether it was shelved with no
    // commits, after a commit, or with a PR still open — those distinctions
    // refine what a LIVE plan's shelf says, and a finished plan has nothing for
    // them to refine.
    if (planPhase === 'delivered' || planPhase === 'released') {
      return { group: 'done', note: FINISHED_PLAN_NOTE };
    }
    // The allowlist, as in the `open` arm and for its reason: a phase the board
    // has not been taught is not startable, and the sentence NAMES it rather
    // than inventing a placement. `''` falls through untouched — a scan
    // predating the field says nothing about the plan, and absent is not a
    // guess. `feature/the-pulse-repairs-the-artifact` rendered `plan phase:
    // NONE` in the same measurement, its plan unresolvable from the branch name;
    // filing that under DONE would be the same guess in the other direction.
    //
    // No worktree check sits between this and the terminal arm above, unlike in
    // the `open` arm where one deliberately does. There is nothing here for it
    // to protect: a deferred row never reads `working`, because the group is
    // about the claim the row makes and shelved work is not work in progress.
    if (planPhase !== '' && planPhase !== 'approved' && planPhase !== 'draft') {
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
  // A LIVE WORKER OVERTAKES A PR THAT NEEDS NOTHING.
  //
  // This arm answers before any worker question, and that is right for a PR
  // that is a person's errand — conflicts, failing checks, no checks, a state
  // the host cannot read. Those want you even while an agent is mid-run.
  //
  // It was NOT right for the rest. An agent that opened its PR and kept working
  // was pulled into `waiting-on-you` by a green or pending PR that asks nothing
  // of anybody, and WORKING went empty while two agents ran — measured
  // 2026-08-17. So a running worker skips this arm exactly where the PR has no
  // errand in it, and nowhere else.
  //
  // Drafts are excluded from the skip on purpose: a draft is still the author's
  // and the author here is the agent, so a green draft with a live worker is
  // the clearest possible WORKING row.
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
    // Ordered ABOVE the wave verdict on purpose: someone editing a branch of a
    // blocked wave is still someone editing. The board reports what is, not
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
    if (localDirty || localLocked || held) {
      return workingLocally(localDirty, localAhead, localLocked, held);
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
    // ABOVE the wave verdict, because a wave's ordering is a question about an
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
    // An earlier wave keeps the first word, WITHIN an approved plan. That scope
    // is what the phase check above establishes: every row reaching here is one
    // an agent may actually take, so the wave verdict is now the only thing
    // left to refine.
    //
    // THE BLOCKED CASE IS NAMED, not inferred from everything-but-eligible.
    // This read `verdict !== 'eligible'`, which sent three inputs to one
    // sentence: `blocked` (true), `complete` (FALSE — a finished wave blocks
    // nobody), and an unrecognised or absent verdict (unknowable). The middle
    // one is the defect the plan measured, and it is the same blocklist-collapse
    // shape as the blocker search above — an allowlist of one good value, so
    // every other input inherits the bad answer.
    if (verdict === 'blocked') return { group: 'not-started', note: BLOCKED_NOTE };
    if (verdict === 'eligible') return { group: 'not-started', note: ELIGIBLE_NOTE };
    // `complete` AND EVERY UNRECOGNISED VERDICT, INCLUDING "", and the answer is
    // deliberately the OLD sentence rather than a new one.
    //
    // An `open` branch of a `complete` wave is a contradiction: the scan counts
    // an `open` branch as outstanding, so a wave holding one cannot be
    // complete. So this arm is unreachable from a scan that agrees with itself,
    // and the row it would build is one nobody has ever seen — which is exactly
    // why it may not invent a sentence. `BLOCKED_NOTE` says *blocked by an
    // earlier wave*: not startable, ordering not satisfied, no claim about
    // WHICH wave. That is the honest reading of a verdict this board cannot
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
    if (worker === 'failed') {
      return {
        group: 'waiting-on-you',
        note: workerExit
          ? `worker failed (exit ${workerExit}) — restart it`
          : 'worker failed — restart it',
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
      return {
        group: 'waiting-on-you',
        note: `worker stopped with work unfinished${what} — resume it`,
      };
    }
    if (worker === 'ended') {
      return { group: 'waiting-on-you', note: 'worker ended, exit status unknown' };
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
    // The GROUP is unchanged from the day it shipped, and deliberately: a fresh
    // claim with no known worker is still the normal opening of a dispatch, and
    // demoting every one of them would be the missing-pid-means-nobody mistake
    // wearing a group instead of a sentence. Only the note stops promising
    // commits are coming.
    if (ageMinutes !== null && ageMinutes <= quietMinutes) {
      return { group: 'working', note: unstarted };
    }
    if (localDirty || localAhead > 0 || localLocked) {
      return workingLocally(localDirty, localAhead, localLocked);
    }
    return {
      group: 'quiet',
      // The age is what the reader came for once the window has passed, so it
      // leads and the worker fact follows it — the same ordering `workingLocally`
      // uses when it has two things to say.
      note:
        ageMinutes === null
          ? unstarted
          : `claimed ${humanAge(ageMinutes)} ago, ${elsewhere ? 'claimed elsewhere' : 'no known worker'}`,
    };
  }
  if (state === 'merged') {
    // Merged work is DONE, not quiet. "Go check whether it died" is the wrong
    // prompt for a branch that landed — putting it in `quiet` was the first
    // thing that looked wrong on screen, and it is a real mis-answer rather
    // than a cosmetic one.
    return verdict === 'complete'
      ? { group: 'done', note: 'merged' }
      : { group: 'done', note: 'merged — wave still open' };
  }
  // state === 'wip'
  if (ageMinutes !== null && ageMinutes <= quietMinutes) {
    // A recent commit is the stronger statement and keeps its own note: the age
    // is what the reader came for, and replacing it would hide it.
    return { group: 'working', note: `last commit ${humanAge(ageMinutes)} ago` };
  }
  if (localDirty || localAhead > 0 || localLocked) {
    return workingLocally(localDirty, localAhead, localLocked);
  }
  if (ageMinutes === null) return { group: 'quiet', note: 'pushed work, age unknown' };
  return { group: 'quiet', note: `no commit for ${humanAge(ageMinutes)}` };
}

/**
 * The processes this machine can see running for a branch — the entities the
 * WAITING ON A MACHINE section lists.
 *
 * THE SECTION IS KEYED ON THE PROCESS, NEVER ON THE HOLDER, and that is the one
 * sentence this function exists to make true. WAITING ON A MACHINE was filled
 * from exactly one source — `pr.checks === 'pending'` — so it described a HOST
 * fact only, while the board sat in the very repository a local run was
 * happening in. Two measured cases fell through:
 *
 *   exit 0, branch pushed, PR open, checks pending, no worker alive
 *     -> NEITHER section. Not WORKING, because no agent held it; not WAITING ON
 *        YOU, because the checks had not landed.
 *
 *   one live worker, PR open, checks pending
 *     -> BOTH, and a single `group` must pick one and be wrong about the other.
 *
 * The first is answered by `group` alone and always was — the PR arm sends a
 * `pending` check to `waiting-on-machine` whatever the worker did, so that row
 * is not homeless and this function must not claim credit for it. What this adds
 * is the SECOND entity: an entry that can coexist with a WORKING row instead of
 * displacing it.
 *
 * DERIVED FROM WHAT THE PULSE ALREADY CARRIES, and deliberately nothing more.
 * `worker`/`workerPid` for a local run, `pr.checks` for a host one — both
 * already read by `classify` two arguments away. No process enumeration, no
 * `ps`, no scanning for cwds inside worktrees: a sweep of that kind would collect
 * every editor and shell a person happens to have open in a checkout and report
 * them as machines working, and it would be a new cost on a scan that is already
 * 18.3 s. The fleet writes a pid where it starts a process; that pid IS the
 * observation, and it is the only local process this board can honestly claim to
 * see.
 *
 * EVIDENCE, NEVER A FORECAST. Each entry says what was observed and stops there.
 * Nothing measures when a local run ends and GitHub does not publish a remaining
 * time for a queued check, so no entry names one — the rule this plan estate
 * repeats at every level, and the reason `evidence` is prose beside a value
 * rather than a verdict in place of one.
 *
 * ORDER: LOCAL FIRST. A local process is the one a reader can act on from where
 * they are sitting — `ps`, a log, the worktree — while a host check is somebody
 * else's machine and a page to open. Both are listed whenever both hold; the
 * question is only which the eye reaches first.
 */
export function machineProcesses(
  worker: WorkerState,
  workerPid: string,
  pr?: PrRecord | null,
): MachineProcess[] {
  const out: MachineProcess[] = [];
  // A RUNNING WORKER IS A PROCESS ON THIS MACHINE, and this is the entry that
  // did not exist. It is the same fact that puts the row in WORKING — one
  // observation, read twice for two questions — so the two can never disagree
  // about whether a worker is alive. *Who is working?* is answered by the agent;
  // *what am I waiting on?* by the process.
  //
  // `running` ONLY. The other seven states are not processes: `finished`,
  // `failed` and `ended` are stopped, `waiting` and `stalled` describe a TASK
  // rather than a running program, and `none`/`elsewhere` are stated unknowns —
  // `plot-dispatch` writes a pid only where it started the worker itself, so an
  // absent record licenses no claim in either direction. Listing an unknown as a
  // process would put *a machine is working* under a branch nobody can see.
  //
  // The pid travels so a reader can go look. Never re-checked here: `kill -0 0`
  // signals the whole process group and succeeds, and liveness is decided once,
  // in the shared classifier.
  if (worker === 'running') {
    out.push({
      origin: 'local',
      // NAMES THE MACHINE AND WITHHOLDS THE VERDICT. *a worker process is
      // running in a local worktree* is what was seen; whether it is nearly done
      // is not, and the pid is how a reader finds out rather than a number this
      // row invents.
      evidence: workerPid
        ? `a worker process is running in a local worktree (pid ${workerPid})`
        : 'a worker process is running in a local worktree',
      pid: workerPid,
    });
  }
  // CI ON THE HOST — the one source this section ever had, kept verbatim as an
  // entry so the two origins are listed by one mechanism. Adding the local case
  // beside a special-cased host case would leave the section with two rules
  // about its own membership, which is how the pair drifts.
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
 * the wave it sits in.
 *
 * THE THIRD ANSWER TRAVELS WITH THE OTHER TWO, and that is the whole reason it
 * is returned here rather than read off the wave by the caller. The note and the
 * verdict are two renderings of one input, and a consumer that finds them
 * disagreeing has found a bug it cannot act on — so they leave this function
 * together, from one reading of one `verdict` argument. `rowsFromPulse` has the
 * wave in hand and could take the field from there; that would be a SECOND
 * derivation, and the pair would then be able to drift.
 *
 * The signature is unchanged. Every caller — including the spread-tuple ones in
 * the suite, whose argument positions this file has broken once before — passes
 * exactly what it passed before and gets one more field back.
 */
export function classify(
  ...args: Parameters<typeof classifyGroup>
): { group: WaitingGroup; note: string; verdict: WaveVerdict | null } {
  return { ...classifyGroup(...args), verdict: waveVerdict(args[1]) };
}

/**
 * The one answer local evidence may produce: working, on grounds this machine
 * can see and no other can.
 *
 * The note names the evidence as LOCAL because that is what a reader needs to
 * judge it. Work that has not been pushed is work nobody else can see, and a row
 * claiming *working* on grounds the next person cannot verify would be its own
 * kind of lie — saying *local* keeps the claim honest.
 *
 * It does not say WHO. A human's edits look exactly like an agent's (git records
 * no author on an uncommitted change), and on an `Impl: same branch` plan they
 * share one branch by design. So the note reports what was observed and on which
 * machine, and a reader who recognises their own editor is not misled — where
 * "agent working" would have misled them.
 *
 * TWO FACTS, AND BOTH ARE SAID WHEN BOTH HOLD — unpushed first. `dirty` means
 * *someone is editing*; `ahead` means *finished work exists that nobody else can
 * see*. An earlier draft reported only the unpushed commits, on the grounds that
 * they are the more urgent fact. That is true and not a reason to drop the
 * other: suppressing a true fact because a second outranks it is precisely the
 * displacement `deferred` used to cause to the note text. The pair also changes
 * the advice — *push this* versus *push this, and someone is still working* —
 * which is the whole reason to distinguish them.
 *
 * The count is a COUNT, never an age. "2 commits not pushed" answers a question
 * no timestamp can: it names an action, and the action belongs to a specific
 * machine.
 *
 * The DIRTY-ONLY note is unchanged from the day it shipped. Rewording it to
 * match the pair would have been tidier and would have changed what every
 * existing dirty row says, for a branch whose subject is the OTHER case.
 *
 * A LOCK OUTRANKS BOTH AND SAYS SO ALONE. `dirty` and `ahead` describe a state
 * the worktree is IN; a lock describes something happening AS THE ROW IS READ,
 * and it is the only one of the three that can go stale between the scan and the
 * next poll four seconds later. So it leads, and it does not append the other
 * two: under a lock `git status` never ran, so `dirty` was not observed and is
 * false by default rather than by measurement — printing "no uncommitted
 * changes" beside it would report an absence of evidence as evidence of absence,
 * which is the mistake the whole exit-code rule exists to prevent. `ahead` is a
 * ref fact and remains true, but it answers *what to do next* for a branch
 * nobody is touching, and the reader of a locked row is being told to wait.
 */
function workingLocally(
  dirty: boolean,
  ahead: number,
  locked = false,
  held = false,
): { group: WaitingGroup; note: string } {
  if (locked) return { group: 'working', note: 'a write is in progress in a local worktree' };
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
    return { group: 'working', note: 'held in a local worktree' };
  }
  if (ahead <= 0) return { group: 'working', note: 'uncommitted work in a local worktree' };
  const unpushed = `${ahead} commit${ahead === 1 ? '' : 's'} not pushed locally`;
  return {
    group: 'working',
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
 * *blocked by an earlier wave*, *claimed elsewhere* — and is only relieved of
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
export function prState(pr: PrRecord): 'green' | 'pending' | 'failing' | 'none' | 'conflicts' | 'unknown' {
  if (pr.mergeable === 'conflicting') return 'conflicts';
  // BELOW `conflicting`, never above it: a host that knows the branch conflicts
  // must still say so, and reordering these two lines loses the cause.
  //
  // Anything that is not one of the two ANSWERS counts, not just the literal
  // word: an adapter predating the field, and a word from a future host, are
  // both in exactly the position Bitbucket is in. The ingest normalizes absent
  // to `'unknown'` already, so this is belt-and-braces there — but `prState` is
  // exported and called directly, and a pure function that says `green` on a
  // record it was handed without the field would be a defect one call site away.
  if (pr.mergeable !== 'mergeable') return 'unknown';
  switch (pr.checks) {
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
export const RELEASE_BRANCH = /^changeset-release\//;

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
 * `build`, `agent`, `plan` and `ticket` are NOT decided here. A build and an
 * agent have no row yet; a plan row and a ticket row are built elsewhere and
 * each says its own kind at its own site, which is the same rule — the kind is
 * stated where the row is created.
 *
 * Exported for test.
 */
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
): RowKind {
  if (RELEASE_BRANCH.test(branch)) return 'release';
  if (conflicts) return 'branch';
  return hasPr ? 'pr' : 'branch';
}

/** The PR fields a row carries: the link, and the two independent conditions. */
export function agentPr(pr: PrRecord): {
  number: number; url: string; draft: boolean;
  state: ReturnType<typeof prState>;
} {
  return { number: pr.number, url: pr.url ?? '', draft: pr.draft === true, state: prState(pr) };
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

/** Flatten a pulse into rows, grouped by what each one asks of you. */
export function rowsFromPulse(
  pulse: FleetPulse,
  ages: Map<string, number | null>,
  repo: string,
  quietMinutes: number,
  prs?: Map<string, PrRecord> | null,
  urlBase = '',
  approvedAt?: Map<string, number> | null,
  now = Date.now(),
  ideaPlans?: Map<string, string> | null,
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
): AgentRow[] {
  const rows: AgentRow[] = [];
  for (const plan of pulse.plans) {
    // WHICH earlier wave is blocking — the plan's FIRST incomplete one, read
    // once per plan rather than searched per row.
    //
    // The first, not the nearest: a row three waves down is released by its
    // predecessors in order, so the one a reader can do something about is the
    // one at the front of the queue. Naming a nearer wave that is itself
    // blocked would answer *blocked by which one* with another blocked thing.
    //
    // Empty name → null, never "": a plan with no `###` sub-headings has an
    // unnamed wave, and the row then keeps the old sentence (*blocked by an
    // earlier wave*) rather than printing `blocked by ``.
    //
    // TWO SEARCHES, NOT ONE — the split this wave exists for. The predicate was
    // `verdict !== 'complete'`, which is the blocklist-collapse shape
    // `green-never-outranks-unknown` removed from `prState`: it catches
    // everything but one good value, so `eligible` and `blocked` arrive as the
    // same answer. They are not. An ELIGIBLE wave is the one a person can start
    // — startable, unclaimed, at the front of the queue — and it is the honest
    // answer to *blocked by which one*. A BLOCKED wave is not: naming it
    // answers that question with another blocked thing, which the paragraph
    // above forbids and the old predicate permitted.
    //
    // They agree on today's pulses and that is precisely the danger. The scan
    // clears `prior_ok` at the first incomplete wave, so exactly one wave per
    // plan can be `eligible` and it is the first non-complete one — the two
    // predicates pick the same wave by an INVARIANT OF THE SCAN that this file
    // never states and does not own. A scan that ever reports two eligible
    // waves, or a blocked wave ahead of an eligible one, would make the old
    // predicate wrong silently. This one is right by its own reasoning.
    //
    // The fallback keeps the first-not-nearest property for the case the split
    // opens up: no eligible wave at all. That happens where every wave is
    // complete (no row is blocked, so nothing reads this) or where the scan
    // reports blocked waves with none eligible — and there the front of the
    // queue is still the most useful thing a reader can be pointed at.
    const eligibleWave = plan.waves.find((w) => w.verdict === 'eligible');
    const blocker = eligibleWave ?? plan.waves.find((w) => w.verdict !== 'complete');
    const blockerName = blocker?.name?.trim() ? blocker.name.trim() : null;
    // HOW MANY branches are left in the blocking wave — the second half of the
    // sentence *blocked by Fold — 2 outstanding*. The scan already decides this
    // number (`plot-fleet-scan.sh` Pass 2); it just ships the list rather than
    // the count, and Principle 3 puts the counting on this side. A branch is
    // outstanding when it is neither deferred nor merged — the SAME predicate the
    // scan uses to settle a wave, so the board's count and the scan's verdict
    // read one fact. Derived per plan beside the name, since both answer the same
    // reader's question about the same wave.
    const blockerOutstanding = blocker
      ? blocker.branches.filter((w) => !w.deferred && w.state !== 'merged').length
      : 0;
    for (const wave of plan.waves) {
      for (const b of wave.branches) {
        const age = ages.get(b.branch) ?? null;
        const pr = prs?.get(b.branch) ?? null;
        // TWO LOOKUPS, ONE FETCH — the split `prsByHeadMap` documents. `pr` is
        // the OPEN PR and answers *what is this branch waiting for*; `linked` is
        // whichever PR this head carries, in any state, and answers *where do I
        // go to read it*. They are the same record on an open branch and differ
        // only after a merge, which is precisely the case that was losing its
        // link.
        const linked = prsByHeadMap?.get(b.branch) ?? pr;
        const { group, note, verdict } = classify(
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
          // of reading as somebody working. The PATH itself is not passed here —
          // it names the place, which the row does through the pulse's
          // `worktrees` list, not through classification.
          b.held);
        // Derived once, read twice below — and derived from `group` rather than
        // re-deciding it, so a row `classify` placed outside `not-started`
        // cannot pick up a waiting-state by a rule that drifted apart from it.
        const waitingOn = waitingOnFor(group, b.state, wave.verdict, plan.phase);
        // The blocking wave's NAME goes into the sentence too, not only into
        // the field. `classify` cannot do it — the name lives on the plan's
        // wave list, which that function has never been given — so the note is
        // refined here, at the one place both are in hand.
        //
        // Through `blockedNote` rather than by concatenation: the unnamed form
        // stays a single declared constant, so a future reader can see which
        // spellings exist instead of finding three assembled variants.
        //
        // The COUNT rides with the name — `blockedNote` drops it where the wave
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
            b.conflicts_known && b.conflicts.length > 0,
          ),
          branch: b.branch,
          plan: plan.file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''),
          planFile: plan.file,
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
          // `local_ahead` travels too, as of the wave that gave it its own mark
          // — and it travels SEPARATELY on purpose. It is finished work sitting
          // still rather than activity, so it must never be OR-ed into the
          // activity predicate: that would mark a branch nobody has touched for
          // hours as though someone were writing to it. Three fields, two
          // meanings, and the row renders them as two marks.
          localDirty: b.local_dirty,
          localLocked: b.local_locked,
          localAhead: b.local_ahead,
          // WHAT THIS ROW IS WAITING FOR, as a value — computed from the same
          // inputs `classify` just used, so the colour and the sentence beside
          // it cannot disagree. See `waitingOnFor`.
          waitingOn,
          // And by WHICH wave, where that is the answer. Only the server can
          // say: `verdict` lives on the wave, the row carries only its own
          // name. Null on every row that is not blocked, and on a blocked row
          // whose blocker has no name.
          blockedBy: waitingOn === 'time' ? blockerName : null,
          // THE WAVE'S VERDICT, as a value — from `classify`, which composed the
          // note beside it from the same reading. Not taken from `wave.verdict`
          // here, though it is in hand: that would be a second derivation of one
          // fact, and the field and the sentence could then drift apart. The
          // pair leaving one function together is what makes them checkable
          // against each other, which is what the tests do.
          //
          // On EVERY row, not only the blocked ones. `blockedBy` above is null
          // outside its one case because a name for a thing that is not
          // blocking is a false claim; a verdict is a fact about the wave
          // whatever the branch is doing, and a merged branch of a still-open
          // wave is precisely the row that had no way to say so.
          verdict,
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
          // one. Same argument the wave verdict settled by computing at one
          // exit.
          processes: machineProcesses(b.worker, b.worker_pid, pr),
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
      localLocked: false,
      // 0 here means UNOBSERVED, exactly as `false` does above — this row was
      // built from the PR map, so no worktree was ever inspected for it. The
      // unpushed mark therefore does not render, which is correct: claiming a
      // branch has nothing unpushed on the strength of never having looked is
      // the same invented observation, one field along.
      localAhead: 0,
      // A PLANLESS branch has no plan to be waiting on, and no wave to be
      // blocked by. Null is the answer rather than a value, and it is the same
      // answer `waitingOnFor` gives every row outside `not-started` — which
      // this row always is, since it reaches the board through the PR map.
      waitingOn: null,
      blockedBy: null,
      // NO WAVE, SO NO VERDICT — null, and for the same reason as the two
      // fields above rather than as a placeholder. This row is built from the PR
      // map: no plan names the branch, so there is no wave to hold a verdict
      // about it.
      //
      // Explicitly NOT the `'eligible'` handed to `classify` a few lines up.
      // That argument exists to steer the function into its PR arm, where an
      // open PR's checks decide the group — it is a routing value, not a claim
      // about a wave, and putting it on the row would state that the ordering
      // of a plan that does not exist has been satisfied.
      verdict: null,
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
    });
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
};

/**
 * Read the cached pulse. Never runs the scan — that is the whole point.
 * `repoRoot` stays a parameter even while the UI shows one repo, so the second
 * one is an addition rather than a rebuild.
 */
export function buildFleet(opts: BuildBoardOptions, quietMinutes = DEFAULT_QUIET_MINUTES): Fleet {
  const entry = ensureCache(opts);
  const repo = path.basename(opts.repoRoot);
  const now = Date.now();
  const ageSeconds = entry.at === null ? 0 : Math.round((now - entry.at) / 1000);
  const rows = entry.pulse
    ? rowsFromPulse(entry.pulse, entry.ages, repo, quietMinutes, entry.prs,
      entry.branchUrlBase, entry.approvedAt, now, entry.ideaPlans, entry.runs,
      entry.questions, entry.prsByHead)
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
    // The inbox travels with its ANSWER, never alone: a consumer reading
    // `issues: []` without `issueAnswer` cannot tell an empty tracker from one
    // that was never reachable, and would render the second as the first.
    issues: entry.issues,
    issueAnswer: entry.issueAnswer,
    issueError: entry.issueError,
  };
}
