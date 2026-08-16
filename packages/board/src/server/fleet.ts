import { execFile } from 'node:child_process';
import path from 'node:path';
import {
  FleetPulseSchema,
  type AgentRow,
  type BranchState,
  type Fleet,
  type FleetPulse,
  type WaitingGroup,
} from '../contract/schema.js';
import type { BuildBoardOptions } from './board.js';

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
  /** APPROVED · CHANGES_REQUESTED · REVIEW_REQUIRED · "" — informational only. */
  review: string;
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
      // A merged or declined PR must NOT reach `classify` by head: it would
      // answer for a branch whose git state has already answered, and reopen a
      // question the merge closed. Numbers are indexed regardless — a link to a
      // merged PR is exactly what a delivered plan's card wants.
      if (pr.head && pr.state === 'OPEN') map.set(pr.head, pr);
      byNumber.set(pr.number, pr);
    }
    entry.prs = map;
    entry.prsByNumber = byNumber;
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
    prs: null, prsByNumber: null, prAt: null, prError: null,
    // 0, so the first fetch happens immediately rather than a minute in.
    prNextAt: 0,
    timer: null, prTimer: null, running: false, prRunning: false,
  };
  caches.set(key, entry);
  // Warm at startup so the first person to open the tab does not wait a second
  // for it; until this lands the endpoint reports `ready: false`. Both sources
  // are warmed — the slower cadence must not mean the tab opens with no PR data
  // for a minute.
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
): { group: WaitingGroup; note: string } {
  if (state === 'deferred') return { group: 'not-started', note: 'deferred' };

  // A PR outranks the git state for work in flight: once a branch has one,
  // what it waits for is decided there, not by commit age. Merged and
  // not-yet-pushed branches keep their git answer.
  if (pr && state !== 'merged' && state !== 'open') {
    const note = reviewNote(pr);
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
    return verdict === 'eligible'
      ? { group: 'not-started', note: 'eligible — nobody has taken it' }
      : { group: 'not-started', note: 'blocked by an earlier wave' };
  }
  if (state === 'claimed') {
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
    if (ageMinutes !== null && ageMinutes <= quietMinutes) {
      return { group: 'working', note: 'claimed, no commits yet' };
    }
    return {
      group: 'quiet',
      note:
        ageMinutes === null
          ? 'claimed, no commits yet'
          : `claimed ${humanAge(ageMinutes)} ago, still no commits`,
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
  if (ageMinutes === null) return { group: 'quiet', note: 'pushed work, age unknown' };
  return ageMinutes <= quietMinutes
    ? { group: 'working', note: `last commit ${humanAge(ageMinutes)} ago` }
    : { group: 'quiet', note: `no commit for ${humanAge(ageMinutes)}` };
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
): AgentRow[] {
  const rows: AgentRow[] = [];
  for (const plan of pulse.plans) {
    for (const wave of plan.waves) {
      for (const b of wave.branches) {
        const age = ages.get(b.branch) ?? null;
        const pr = prs?.get(b.branch) ?? null;
        const { group, note } = classify(b.state, wave.verdict, age, quietMinutes, pr);
        rows.push({
          repo,
          branch: b.branch,
          plan: plan.file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''),
          planFile: plan.file,
          wave: wave.name || '(unnamed)',
          state: b.state,
          group,
          ageMinutes: age,
          note: b.claimed ? `${note} · ${b.claimed}` : note,
          // The link the row could not offer before. `url` is the adapter's
          // string or "", never anything this file composed.
          pr: pr ? { number: pr.number, url: pr.url ?? '' } : null,
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
    const { group, note } = pr.draft
      ? { group: 'waiting-on-you' as const, note: `PR #${pr.number}, draft` }
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
      pr: { number: pr.number, url: pr.url ?? '' },
      waitingDays: null,
    });
  }

  rows.sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (g !== 0) return g;
    return (b.ageMinutes ?? -1) - (a.ageMinutes ?? -1);
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
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds,
    ready: entry.pulse !== null,
    error: entry.error,
    rows: entry.pulse
      ? rowsFromPulse(entry.pulse, entry.ages, repo, quietMinutes, entry.prs,
        entry.branchUrlBase, entry.approvedAt, now, entry.ideaPlans)
      : [],
    summary: entry.pulse?.summary ?? EMPTY_SUMMARY,
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
