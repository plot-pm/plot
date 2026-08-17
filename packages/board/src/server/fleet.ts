import { execFile } from 'node:child_process';
import path from 'node:path';
import {
  DRAFT_PLAN_NOTE,
  ELIGIBLE_NOTE,
  FleetPulseSchema,
  toBoardPhase,
  type AgentRow,
  type BranchState,
  type Fleet,
  type FleetPulse,
  type Phase,
  type StuckRun,
  type WaitingGroup,
  type WorkerState,
} from '../contract/schema.js';
import { stuckState, summarizeStuck } from './stuck.js';
import type { BuildBoardOptions } from './board.js';
import { readBridge, writeBridge } from './pulse-bridge.js';

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
  pulse: FleetPulse | null;
  ages: Map<string, number | null>;
  at: number | null;
  error: string | null;
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
   * PR data is cached BESIDE the pulse, with its own timestamp and error — the
   * two sources fail independently. The host can be down while git is fine, and
   * a fetch can fail behind a VPN while `gh` works; sharing one staleness would
   * freeze data that was available the whole time.
   */
  prs: Map<string, PrRecord> | null;
  /**
   * The same records keyed by PR NUMBER. The fleet tab asks "what is this
   * branch waiting for" and looks up by head; the board asks "where does PR
   * #113 live" and has only the number a plan wrote down. One fetch, two
   * indexes — rather than a second `pr-list` call on the board path.
   */
  prsByNumber: Map<number, PrRecord> | null;
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
   * Epoch ms before which the PR fetch must not fire again. Normally
   * `prAt + PR_REFRESH_MS`; pushed further out when the host reports a rate
   * limit, to the reset it named if it named one. A gate rather than a second
   * timer: one clock decides, and a backoff cannot leave a timer orphaned.
   */
  prNextAt: number;
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
 */
export function rateLimitBackoffMs(message: string, now = Date.now()): number | null {
  // "Please wait 60 seconds" / "try again in 45 seconds" — the host said how
  // long, so wait exactly that (never below the ordinary cadence, since a
  // shorter wait would just re-hit the limit).
  const seconds = /(?:wait|retry|try again)(?:\s+\w+){0,3}?\s+(\d+)\s*seconds?/i.exec(message);
  if (seconds) return Math.max(PR_REFRESH_MS, Number(seconds[1]) * 1000);

  // An absolute reset stamp, if the message carries one.
  const reset = /rate limit.*?reset[^0-9]{0,20}(\d{10,13})/i.exec(message);
  if (reset) {
    const at = Number(reset[1]);
    const ms = (at < 1e12 ? at * 1000 : at) - now;
    if (ms > 0) return ms;
  }

  // The bare exhaustion message — no reset offered. Back off to the ceiling
  // rather than keep firing into a closed door.
  if (/rate limit/i.test(message)) return PR_BACKOFF_MAX_MS;
  return null;
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
      /* one branch's history is unavailable; the other two evidence lines stand */
    }
  }
  entry.runs = runs;
}

async function refreshPrs(opts: BuildBoardOptions, entry: CacheEntry): Promise<void> {
  try {
    const out = await run('bash',
      [path.join(opts.scriptsDir, 'plot-host.sh'), 'pr-list', '--rich',
        '--state', 'all', '--limit', String(PR_LIMIT)],
      opts.repoRoot);
    const map = new Map<string, PrRecord>();
    const byNumber = new Map<number, PrRecord>();
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
    }
    entry.prs = map;
    entry.prsByNumber = byNumber;
    await refreshRuns(opts, entry, map);
    entry.prAt = Date.now();
    entry.prNextAt = entry.prAt + PR_REFRESH_MS;
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
    const backoff = rateLimitBackoffMs(message);
    entry.prNextAt = Date.now() + (backoff ?? PR_REFRESH_MS);
  }
}

/**
 * Fetch PRs if the cadence gate allows it. Called from the PR timer and once at
 * start-up; the gate (`prNextAt`) is what turns a rate-limit into a wait rather
 * than a tighter loop, so nothing may bypass it.
 */
async function maybeRefreshPrs(opts: BuildBoardOptions, entry: CacheEntry): Promise<void> {
  if (entry.prRunning || Date.now() < entry.prNextAt) return;
  entry.prRunning = true;
  try {
    await refreshPrs(opts, entry);
  } finally {
    entry.prRunning = false;
  }
}

async function refresh(opts: BuildBoardOptions, entry: CacheEntry): Promise<void> {
  if (entry.running) return;
  entry.running = true;
  try {
    // Default mode, WITH the fetch: the refresh is off the request path, so a
    // second of work is free — and the fetch is what lets the board see
    // branches a remote worker pushed. `--json` is the only flag added.
    const out = await run('bash',
      [path.join(opts.scriptsDir, 'plot-fleet-scan.sh'), '--json'], opts.repoRoot);
    const parsed = FleetPulseSchema.parse(JSON.parse(out));
    entry.pulse = parsed;
    entry.ages = await branchAges(opts);
    entry.branchUrlBase = await readBranchUrlBase(opts);
    entry.approvedAt = await approvalDates(opts, parsed);
    // From the REFS, not from `entry.prs`. The PR map is filled on its own
    // 60 s timer, so at the first git refresh it is still null — the list came
    // back empty and nothing recomputed it, because this timer does not watch
    // that one. Two clocks, one dependency: the same shape that pinned the
    // countdown at zero earlier today.
    entry.ideaPlans = await ideaPlanFiles(opts);
    entry.at = Date.now();
    entry.error = null;
    // The one place the bridge is written, and it is INSIDE the success path on
    // purpose. A scan that failed must not overwrite the last good answer — the
    // same one-directional rule the in-memory cache obeys three lines down, and
    // the only thing standing between a `--watch` restart and an empty board.
    writeBridge(opts.repoRoot, {
      at: entry.at,
      pulse: parsed,
      ages: entry.ages,
      branchUrlBase: entry.branchUrlBase,
      approvedAt: entry.approvedAt,
      ideaPlans: entry.ideaPlans,
    });
  } catch (err) {
    // A failed refresh NEVER overwrites a good result. Replacing real state
    // with emptiness because one scan failed is what makes a monitoring view
    // untrustworthy — the tab keeps the last pulse, its age, and this error.
    entry.error = err instanceof Error ? err.message : String(err);
  } finally {
    entry.running = false;
  }
}

function ensureCache(opts: BuildBoardOptions): CacheEntry {
  const key = cacheKey(opts);
  let entry = caches.get(key);
  if (entry) return entry;

  entry = {
    pulse: null, ages: new Map(), at: null, error: null, branchUrlBase: '',
    approvedAt: new Map(),
    ideaPlans: new Map(),
    prs: null, prsByNumber: null, runs: new Map(), prAt: null, prError: null,
    // 0, so the first fetch happens immediately rather than a minute in.
    prNextAt: 0,
    timer: null, prTimer: null, running: false, prRunning: false,
  };
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
 * with `toBoardPhase`. That produces rows that contradict themselves, and this
 * repo had the example sitting in it: `opus5-longhorizon-hardening` is
 * `Phase: Approved` with zero `Started:` records while six of its branches carry
 * real commits. The board says Design ("approved, nobody has begun"); the pulse
 * says `in progress`. Both are right about their own source, and a row labelled
 * *Design* beside a note reading *no commit for 22 days* is two statements about
 * one branch that cannot both be true.
 *
 * So git supplies the `started` half. A branch carrying real work IS a start,
 * whether or not anyone wrote the record — the same principle that made
 * `fleet-sees-merged-branches` read merge commits rather than plan annotations.
 * The `opus5` rows then read Development while the board CARD keeps saying
 * Design, and that divergence is itself information: the plan's bookkeeping is
 * behind, which is worth seeing rather than smoothing over.
 *
 * `toBoardPhase` stays the single definition of the mapping and gains no second
 * implementation here. This function composes it with the branch state; every
 * phase word it can return came out of that call.
 *
 * TWO PLACES THE COMPOSITION IS DELIBERATELY NOT SYMMETRIC.
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
 * **`deferred` sends the row BACK a phase.** The annotation does not mean
 * "paused, resuming later": the vocabulary is explicit that the branch *isn't
 * needed* and was *given up deliberately*, and `plot-deliver` skips deferred
 * branches in its completeness gate — a plan delivers without them. So the row
 * returns to where it is decided whether the branch is wanted at all, which is
 * the plan's own phase with the git evidence ignored. Past `delivered` the plan
 * is done deciding, so nothing moves.
 *
 * The `deferred` FACT is not carried by the phase — a bare Design row is
 * indistinguishable from one nobody ever started. `state` carries it, and the
 * row renders a badge from that.
 */
export function rowPhase(planPhase: string, state: BranchState): Phase | null {
  // A branch handed back returns to the plan's own phase, ignoring whatever its
  // commits say — the one place intent outranks git. `toBoardPhase(_, false)`
  // is Design for an approved plan and Discovery for a draft, which is exactly
  // "back to where it is decided whether this is wanted".
  if (state === 'deferred') return toBoardPhase(planPhase, false);
  // Real work on THIS branch is what makes THIS row Development — the plan's
  // own `Started:` count is deliberately not consulted.
  //
  // A row is a statement about one branch, and a plan's records are about the
  // plan. A three-branch plan with one branch built and two untouched is in
  // Development as a plan, and the untouched rows are not: they are the
  // hand-off point, which is what Design means and what the Start button on
  // them offers. Carrying the plan's count onto them would put `Development`
  // beside a note reading *eligible — nobody has taken it*, which is the same
  // class of self-contradicting row this derivation exists to remove.
  //
  // `merged` counts: work that landed is a stronger statement than a commit.
  // `claimed` does NOT — an empty claim marker is a dispatcher taking the
  // branch, not an agent having built anything.
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
export function classify(
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
   * Last in the parameter list because it is the newest, so every existing caller
   * is unchanged — a caller with nothing to say about a lock is a caller that
   * could not look.
   */
  localLocked = false,
): { group: WaitingGroup; note: string } {
  // A deferred branch is not-started because nobody is working on it — the
  // group is about the claim the row makes, not about the age of its last
  // commit, so a fresh commit does not pull it into `working`. Work somebody
  // gave up is not work in progress.
  //
  // But the NOTE is not the word `deferred`. That was the old answer and it
  // displaced whatever else the row had to say: a branch started and then
  // shelved read as never begun, with its age and its PR erased. The fact is
  // carried by `state`, beside the note rather than instead of it — the same
  // shape as the `no story` badge on a plan card. Mark the thing; do not bend
  // the state to encode it.
  if (state === 'deferred') {
    if (pr) return { group: 'not-started', note: withNote(`PR #${pr.number}`, reviewNote(pr)) };
    if (ageMinutes === null) return { group: 'not-started', note: 'no commits' };
    return { group: 'not-started', note: `last commit ${humanAge(ageMinutes)} ago` };
  }

  // A PR outranks the git state for work in flight: once a branch has one,
  // what it waits for is decided there, not by commit age. Merged and
  // not-yet-pushed branches keep their git answer.
  if (pr && state !== 'merged' && state !== 'open') {
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
        return { group: 'waiting-on-you', note: withNote(`PR #${pr.number}, checks unavailable`, note) };
      case 'green':
        if (pr.draft) break; // a draft is still the author's, not yours
        return { group: 'waiting-on-you', note: withNote(`PR #${pr.number} green`, note) };
    }
  }
  if (state === 'open') {
    // An earlier wave keeps the first word. Both statements are true of a
    // Draft plan's later waves, and the wave one is the more specific: it names
    // a branch that must land, where the draft note names a review. Saying the
    // weaker of two true things is how a note stops being worth reading.
    if (verdict !== 'eligible') return { group: 'not-started', note: 'blocked by an earlier wave' };
    // The DRAFT case. `eligible` is a wave verdict — an answer about ordering
    // WITHIN a plan — and it is correct here: no earlier wave is outstanding.
    // The row's sentence claims more than that, and the extra claim is what is
    // false: a plan under review has not reached the hand-off point, and
    // `plot-dispatch` refuses its branches.
    //
    // The group does NOT change. `not-started` is still exactly right — nobody
    // has taken it, and nobody should — so this narrows the note and nothing
    // else. Moving the row somewhere else would hide work that is genuinely
    // coming, which is the opposite of what the tab is for.
    if (planPhase === 'draft') return { group: 'not-started', note: DRAFT_PLAN_NOTE };
    return { group: 'not-started', note: ELIGIBLE_NOTE };
  }
  // A WORKER THAT STOPPED is a person's errand, whatever the commit clock says.
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
    if (worker === 'ended') {
      return { group: 'waiting-on-you', note: 'worker ended, exit status unknown' };
    }
  }

  if (state === 'claimed') {
    // A RUNNING worker is direct evidence, and it outranks the clock in both
    // directions the clock gets wrong: a claim older than the quiet window is
    // not abandoned while its worker is alive, and a fresh claim reads working
    // for a reason better than its age. The pid is the scan's, not re-derived
    // here — `kill -0 0` succeeds against the whole process group, so a pid of
    // `0` read on this side would be alive forever. The scan already rejected
    // it, and `running` can therefore never arrive carrying one.
    if (worker === 'running') {
      return { group: 'working', note: `worker running (pid ${workerPid})` };
    }
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
): { group: WaitingGroup; note: string } {
  if (locked) return { group: 'working', note: 'a write is in progress in a local worktree' };
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
  const checks =
    pr.mergeable === 'conflicting' ? 'conflicts'
      : pr.checks === 'failing' ? 'checks failing'
        : pr.checks === 'pending' ? 'CI running'
          : pr.checks === 'none' ? 'no checks'
            : pr.checks === 'unknown' ? 'checks unavailable'
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
 * Only the literal `conflicting` promotes. `unknown` mergeability — Bitbucket,
 * or a PR GitHub has not finished computing — falls through to whatever `checks`
 * can say, because absent is not a conflict any more than it is a clearance.
 *
 * `draft` is NOT consulted here. It is its own field on the row for the reason
 * `AgentPr` states: a draft has CI like anything else, and answering both
 * questions with one value is what kept WAITING ON A MACHINE empty.
 */
export function prState(pr: PrRecord): 'green' | 'pending' | 'failing' | 'none' | 'conflicts' | 'unknown' {
  if (pr.mergeable === 'conflicting') return 'conflicts';
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
): AgentRow[] {
  const rows: AgentRow[] = [];
  for (const plan of pulse.plans) {
    for (const wave of plan.waves) {
      for (const b of wave.branches) {
        const age = ages.get(b.branch) ?? null;
        const pr = prs?.get(b.branch) ?? null;
        const { group, note } = classify(
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
          b.local_locked);
        rows.push({
          repo,
          branch: b.branch,
          plan: plan.file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''),
          planFile: plan.file,
          wave: wave.name || '(unnamed)',
          state: b.state,
          // From the PAIR — see `rowPhase`. The plan supplies its phase; this
          // branch supplies the evidence that outranks a missing record.
          phase: rowPhase(plan.phase, b.state),
          group,
          ageMinutes: age,
          note: b.claimed ? `${note} · ${b.claimed}` : note,
          // The link the row could not offer before, and now the condition too.
          // `url` is the adapter's string or "", never anything this file
          // composed; `state` and `draft` are the same facts the note spells
          // out, stated as values so the cell can format them.
          pr: pr ? agentPr(pr) : null,
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
          // `local_ahead` deliberately does NOT travel with them. It is
          // finished work sitting still rather than activity, it gets its own
          // static mark in a later wave, and OR-ing it in here would mark a
          // branch nobody has touched for hours as though someone were writing
          // to it.
          localDirty: b.local_dirty,
          localLocked: b.local_locked,
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
      plan: ideaSlug,
      // Resolvable since the plan viewer learned to read branch plans: before
      // that this was deliberately blank, because linking to a file the route
      // would 404 on is worse than plain text. The route reads both sources
      // now, so the caution is obsolete — and leaving it in cost the grouped
      // rows their only way to open the plan.
      planFile: ideaPlans?.get(branch) ?? '',
      wave: '',
      state: 'wip',
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
      entry.branchUrlBase, entry.approvedAt, now, entry.ideaPlans, entry.runs)
    : [];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds,
    ready: entry.pulse !== null,
    error: entry.error,
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
  };
}
