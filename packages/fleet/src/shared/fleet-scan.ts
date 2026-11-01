import path from 'node:path';

import { FleetReadingSchema, type FleetReading } from '@plot-pm/domain/entities/fleet';
import { listingBackoff, listingSpend, PR_READ_BEAT_MS, type LimitBasis } from '@plot-pm/domain';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Agents } from '@plot-pm/domain/ports/agents';
import type { Host } from '@plot-pm/domain/ports/host';
import type { PlanStore } from '@plot-pm/domain/ports/plan-store';
import type { Processes } from '@plot-pm/domain/ports/processes';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { readBranchConflicts, readBranchReadings, type BranchStagePrs } from '@plot-pm/domain/workflows/plan-walk-branches';
import { readDeskReadings } from '@plot-pm/domain/workflows/plan-walk-desks';
import { readEstate } from '@plot-pm/domain/workflows/plan-walk-estate';
import { assemblePlanWalk, fleetReading } from '@plot-pm/domain/workflows/plan-walk-assembly';
import type { FleetState } from '@plot-pm/domain/ports/fleet-state';
import { githubListingPages } from '@plot-pm/domain/rules/listing-page';
import { hostAndPathOfRemote } from '@plot-pm/domain/rules/remote-url';
import {
  foldScanListing, parseScanListingRows, readCarriedPrStates, renderScanListing, scanListingWindowFor,
  type CarriedListing, type ScanListingAnswer, type ScanListingFold, type ScanListingWindow,
} from '@plot-pm/domain/rules/scan-listing';
import { PR_FULL_READ_MS } from './pr-refresh.js';

/** The scan Plot ships, streamed one plan at a time. */
export const FLEET_SCAN = 'plot-fleet-scan.sh';

/** The pulse's base beat, in ms. The scan takes every beat. */
export const REFRESH_MS = 5_000;

/**
 * The PR reader's cadence, in ms. It takes every twelfth beat. The domain's
 * staleness grace counts in the same beat.
 */
export const PR_REFRESH_MS = PR_READ_BEAT_MS;

/**
 * The listing's own unstretched base, in ms — the board's own 60 s share, and
 * deliberately its own name rather than a reuse of {@link REFRESH_MS} or
 * {@link PR_REFRESH_MS}.
 *
 * NEITHER OF THE OTHER TWO NAMES THIS NUMBER. `REFRESH_MS` is how often
 * `scanOnce` runs at all, independent of whether a listing is due — passing it
 * to `listingSpend` as the listing's own base made an idle fleetd's
 * unstretched listing spend 720 requests an hour, twelve times the board's own
 * 60/hr share, before any stretch ran. `PR_REFRESH_MS` is a different reader's
 * cadence, the PR pass's; reusing it would let a future change to the PR
 * pass's own interval silently retune the listing's share, and vice versa.
 */
export const LISTING_REFRESH_MS = 60_000;

/**
 * The scan's budget, in ms. Measured 34–52 s on this repository and 84 s before
 * the per-plan reads were batched; 90 s is headroom over the loaded cost, not
 * cover for a regression.
 */
export const FLEET_SCAN_BUDGET_MS = 90_000;

/**
 * What a scan carries from one pass to the next.
 *
 * The two cost caches the scan hands back to itself: the terminal-branch map
 * (`PLOT_TERMINAL_CACHE`) and the PR listing (`PLOT_PR_LISTING`) with the
 * cadence it was fetched on. A process that holds this holds the cost of the
 * scan down; a fresh one re-derives everything, which is correct and slow.
 *
 * `backoffUntil`/`backoffMs` hold a listing back-off: while it is open, the
 * scan skips only the host listing — it still runs every beat, hands the
 * shell its carried listing, and still writes the bridge.
 */
export interface ScanState {
  /**
   * The terminal-branch map: what the last completed scan reported, plus the
   * rows a killed scan streamed since. Empty on a cold start.
   */
  terminal: string;
  /**
   * The PR listing the last scan that fetched one reported in full. Empty
   * until one is fetched.
   */
  listing: string;
  /** Epoch ms the listing was fetched, or null before the first one. */
  listingAt: number | null;
  /** The interval the last `listingSpend` verdict decided, in ms. */
  listingIntervalMs: number;
  /** How many branches the last listing swept. */
  listingBranches: number;
  /** Age in ms of a reused listing on the latest scan, or null where it fetched. */
  listingReusedAgeMs: number | null;
  /**
   * The listing fleetd last read through the host, with its rows' `updatedAt`
   * and when its full read ran, or null where `listing` did not come from
   * such a read. Read by {@link scanListingWindowFor} alone, on both GitHub
   * and Bitbucket.
   */
  listingHeld: CarriedListing | null;
  /**
   * When the held listing back-off ends, or null where none is held. Set by a
   * refused or failed listing attempt, cleared by the next adopted one.
   */
  backoffUntil: number | null;
  /** The back-off interval that produced `backoffUntil`, or null where none is held. */
  backoffMs: number | null;
  /**
   * Host requests this scan has spent since the tick last read and zeroed it —
   * the in-process `askPrList` calls plus the shell's own reported `spend:`
   * count. Never reset at the top of a pass; only the reader zeroes it.
   */
  calls: number;
}

/**
 * A scan state as a fresh process holds it.
 *
 * @returns every field at its cold-start value.
 */
export const freshScanState = (): ScanState => ({
  terminal: '',
  listing: '',
  listingAt: null,
  listingIntervalMs: LISTING_REFRESH_MS,
  listingBranches: 0,
  listingReusedAgeMs: null,
  listingHeld: null,
  backoffUntil: null,
  backoffMs: null,
  calls: 0,
});

/** What a scan reads through; every spawn goes through `scripts` or `refs`. */
export interface ScanWorld {
  repoRoot: string;
  scripts: Scripts;
  refs: Refs;
  /** The configured git host's name, e.g. `github`. */
  backend: () => Promise<string>;
  /** The ports the in-process plan walk reads through. */
  walk: WalkPorts;
}

/** The ports the plan walk reads through, beside `refs` and `scripts`. */
export interface WalkPorts {
  host: Host;
  /** Builds the plan store over a ref and the plan directory. */
  plans: (ref: string, planDir: string) => PlanStore;
  trees: Trees;
  agents: Agents;
  processes: Processes;
}

/** The pulse and the five facts read beside it. */
export interface ScanResult {
  reading: FleetReading;
  /** Branch → minutes since its tip commit. */
  ages: Map<string, number | null>;
  /** Branch → its tip commit's epoch ms. */
  tipAt: Map<string, number | null>;
  branchUrlBase: string;
  /** Plan basename → approval date, epoch ms. */
  approvedAt: Map<string, number>;
  /** Idea branch → the plan file it carries. */
  ideaPlans: Map<string, string>;
}

/** How a scan runs. */
export interface ScanOptions {
  /** Retained for callers; the in-process walk writes no bridge of its own. */
  record: boolean;
  /** Retained for callers; the in-process walk streams no lines. */
  onLine?: (line: string) => void;
}

/**
 * Requests one fleet-scan listing spends on `backend`.
 *
 * Bitbucket's two modes have genuinely different request shapes rather than a
 * smooth function of row count, so `window` names which one `scanOnce` is
 * about to make before it makes it: a `full` read sweeps every tracked branch
 * under three states (`branches x 3`), and a `delta` read asks one unbranched
 * `--state open --rich` plus one windowed `--state all --since`, at most 4
 * requests (1 open page, up to 3 windowed pages at `BB_LIST_PAGELEN`). GitHub's
 * `gh pr list` pages at 100 rows per request: one `--state open` call plus
 * `ceil(rows / 100)` calls for `--state all`, so the cost is
 * `1 + max(1, ceil(rows / 100))`. `rows` absent (no adopted listing yet) prices
 * as 2 — the first listing is always permitted, so this price decides nothing.
 *
 * @param backend - the configured host.
 * @param branches - how many branches the scan tracks (Bitbucket only).
 * @param rows - how many branch lines the last adopted GitHub listing held, or
 *   null where none has been adopted yet.
 * @param window - which read Bitbucket is about to make; ignored on GitHub.
 * @returns the requests one listing spends; never 0.
 */
export const scanListingCost = (
  backend: string,
  branches: number,
  rows: number | null,
  window: ScanListingWindow = { kind: 'full' },
): number => {
  if (backend === 'bitbucket') {
    if (window.kind === 'delta') return 4;
    const swept = Math.max(0, Math.trunc(branches)) * 3;
    return swept > 0 ? swept : 3;
  }
  if (rows === null) return 2;
  return 1 + githubListingPages(rows);
};

/**
 * How many branches a reported listing swept, or null where it said nothing.
 *
 * @param listed - the scan's reported listing, one note or branch per line.
 * @returns the `.branches` count, or null where the note is absent or not a count.
 */
export const listedBranchCount = (listed: string): number | null => {
  for (const line of listed.split('\n')) {
    const [key, value] = line.split('\t');
    if (key !== '.branches') continue;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  return null;
};

/**
 * How many branch rows a reported listing holds.
 *
 * Counts every non-empty line whose key does not start with `.` — a dotted
 * note (`.branches`, `.list-complete`, `.list-arrived`, …) is not a branch row.
 *
 * @param listed - the scan's reported listing, one note or branch per line.
 * @returns the row count; 0 for an empty listing.
 */
export const listedRowCount = (listed: string): number =>
  listed.split('\n').filter((line) => line !== '' && !line.split('\t')[0].startsWith('.')).length;

/**
 * Whether a reported listing ends with its `.list-arrived` line.
 *
 * `plot-fleet-scan.sh` prints `.list-arrived` after every other listing line,
 * so a listing cut short by a kill does not end with it.
 *
 * @param listed - the scan's reported listing, one note or branch per line.
 * @returns true where the last non-empty line is the `.list-arrived` note.
 */
export const listingEnded = (listed: string): boolean =>
  listed.split('\n').filter((line) => line !== '').at(-1)?.split('\t')[0] === '.list-arrived';

/**
 * Merges terminal-map rows into a prior map, keyed by branch name.
 *
 * @param prior - the map held before the scan, one `branch<TAB>…` row per line.
 * @param learned - the rows the scan streamed, in the same shape.
 * @returns every row of `learned`, plus each row of `prior` whose branch
 *   `learned` does not name; one row per line, each ending in a newline.
 */
export const mergeTerminal = (prior: string, learned: string): string => {
  const rows = new Map<string, string>();
  for (const line of `${prior}\n${learned}`.split('\n')) {
    if (line !== '') rows.set(line.split('\t')[0], line);
  }
  return [...rows.values()].map((line) => `${line}\n`).join('');
};

/** The host's spend, as `plot-host.sh spend-rate` reports it. */
export interface SpendRate {
  perHour: number | null;
  resetAt: number | null;
  limit: number | null;
  basis: LimitBasis;
  account: string | null;
}

/**
 * Asks the host connector what this account has spent.
 *
 * @param scripts - the runner to ask through.
 * @returns the record, or null where the connector did not answer or answered
 *   something that is not a record.
 */
export const spendRateFor = async (scripts: Scripts): Promise<SpendRate | null> => {
  try {
    const said = await scripts.hostSaid(['spend-rate']);
    if (said.answer !== 'answered') return null;
    const parsed: unknown = JSON.parse(said.stdout);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { perHour, resetAt, limit, basis, account } = parsed as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    return {
      perHour: num(perHour),
      resetAt: num(resetAt),
      limit: num(limit),
      basis: basis === 'actual' || basis === 'predicted' ? basis : 'unknown',
      account: typeof account === 'string' && account !== '' ? account : null,
    };
  } catch {
    return null;
  }
};

/** The hosts an origin URL names for Bitbucket Cloud: the web host and both SSH hosts. */
const BITBUCKET_CLOUD_HOSTS: ReadonlySet<string> = new Set([
  'bitbucket.org',
  'ssh.bitbucket.org',
  'altssh.bitbucket.org',
]);

/**
 * The branch-URL prefix for an origin URL.
 *
 * @param origin - the output of `git remote get-url origin`.
 * @returns `https://host/owner/repo/tree/` on GitHub, `…/branch/` on Bitbucket
 *   Cloud, and `''` for any other host or an unparseable URL.
 */
export const branchUrlBase = (origin: string): string => {
  const trimmed = origin.trim();
  if (!trimmed) return '';
  const parsed = hostAndPathOfRemote(trimmed);
  if (parsed === null) return '';
  const host = parsed.host;
  const repoPath = parsed.path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (!repoPath || repoPath.includes('..')) return '';
  if (host === 'github.com' || /(^|\.)github\./.test(host)) {
    return `https://${host}/${repoPath}/tree/`;
  }
  // The web link keeps `bitbucket.org` whichever host the remote names: the SSH
  // hosts (`ssh.bitbucket.org` from 2026-11-12, `altssh.bitbucket.org` on port
  // 443) change where Git connects, not where the web pages live.
  if (BITBUCKET_CLOUD_HOSTS.has(host)) {
    return `https://bitbucket.org/${repoPath}/branch/`;
  }
  return '';
};

/**
 * Minutes since each remote branch's tip commit, and the tip's epoch ms.
 *
 * @param refs - the refs port.
 * @returns both maps; empty where the refs cannot be read.
 */
export const branchAges = async (
  refs: Refs,
): Promise<{ ages: Map<string, number | null>; tipAt: Map<string, number | null> }> => {
  const ages = new Map<string, number | null>();
  const tipAt = new Map<string, number | null>();
  try {
    const dates = await refs.branchDates(['refs/remotes/origin']);
    if (!dates.ok) return { ages, tipAt };
    const now = Date.now() / 1000;
    for (const { branch, committedAt } of dates.value) {
      ages.set(branch, Math.max(0, Math.round((now - committedAt) / 60)));
      tipAt.set(branch, Math.round(committedAt * 1000));
    }
  } catch {
    /* no refs readable — every age stays absent, and the UI says so */
  }
  return { ages, tipAt };
};

/**
 * Where plan files live, from `## Plot Config`.
 *
 * @returns the configured directory, or `docs/plans/` where it cannot be asked.
 */
export const planDirectory = async (scripts: Scripts): Promise<string> => {
  try {
    const answer = await scripts.config('Plan directory', 'docs/plans/');
    if (!answer.ok) return 'docs/plans/';
    return answer.value.trim() || 'docs/plans/';
  } catch {
    return 'docs/plans/';
  }
};

/**
 * The plan file each idea branch carries, keyed by branch name.
 *
 * @returns the map; a branch whose tree cannot be read is absent.
 */
export const ideaPlanFiles = async (
  world: Pick<ScanWorld, 'refs' | 'scripts'>,
): Promise<Map<string, string>> => {
  const found = new Map<string, string>();
  try {
    const planDir = await planDirectory(world.scripts);
    const tips = await world.refs.branchTips(['refs/remotes/origin/idea/*']);
    if (!tips.ok) return found;
    for (const { branch } of tips.value) {
      const slug = /^idea\/(.+)$/.exec(branch)?.[1];
      if (!slug) continue;
      const blobs = await world.refs.listBlobs(`origin/${branch}`, planDir);
      if (!blobs.ok) continue;
      const hit = blobs.value.find((b) => b.path.endsWith(`${slug}.md`));
      if (hit) found.set(branch, path.basename(hit.path));
    }
  } catch {
    /* a branch that cannot be read is simply absent */
  }
  return found;
};

/**
 * When each plan was approved, in epoch ms, keyed by plan file basename.
 *
 * A plan with no `Approved:` record is absent from the map.
 */
export const approvalDates = async (
  world: Pick<ScanWorld, 'repoRoot' | 'scripts'>,
  pulse: FleetReading,
): Promise<Map<string, number>> => {
  const dates = new Map<string, number>();
  if (pulse.plans.length === 0) return dates;
  const planDir = await planDirectory(world.scripts);
  const files = pulse.plans.map((p) => path.join(world.repoRoot, planDir, p.file));
  try {
    const answer = await world.scripts.planMeta(files);
    if (!answer.ok) return dates;
    for (const line of answer.value.split('\n')) {
      if (!line.trim()) continue;
      const meta = JSON.parse(line) as { file?: string; approved_raw?: string };
      if (!meta.file || !meta.approved_raw) continue;
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(meta.approved_raw.trim());
      if (!m) continue;
      const at = Date.parse(`${m[1]}T00:00:00Z`);
      if (Number.isNaN(at)) continue;
      dates.set(path.basename(meta.file), at);
    }
  } catch {
    /* no parser, no plans dir, unreadable file — every row shows no age */
  }
  return dates;
};

/**
 * This repository's branch-URL prefix, from `git remote get-url origin`.
 *
 * @returns the prefix, or `''` where there is no origin.
 */
export const readBranchUrlBase = async (refs: Refs): Promise<string> => {
  try {
    const url = await refs.remoteUrl('origin');
    return url.ok ? branchUrlBase(url.value) : '';
  } catch {
    return '';
  }
};

/** The `pr-list --limit` the scan asks with when `PLOT_PR_LIST_LIMIT` names none. */
export const SCAN_PR_LIST_LIMIT = 3000;

/**
 * The `pr-list --limit` the scan asks with: `PLOT_PR_LIST_LIMIT` where it is
 * a positive integer, else {@link SCAN_PR_LIST_LIMIT} — the value
 * `plot-fleet-scan.sh`'s `PR_LIST_LIMIT` takes from the same variable.
 *
 * @param env - the environment to read.
 * @returns the limit.
 */
export const scanPrListLimit = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.PLOT_PR_LIST_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : SCAN_PR_LIST_LIMIT;
};

/**
 * Asks the host one `pr-list` call and reads it into rows.
 *
 * @param scripts - the one place `plot-*.sh` is invoked.
 * @param args - the `pr-list` arguments.
 * @param onCall - called once the host has answered, win or lose — the
 *   scan's own tally of real requests spent.
 * @returns the rows and the raw stderr `foldScanListing`'s whole-page check
 *   reads, or `verdict: 'failed'` with no rows where the call failed, could
 *   not be asked, or printed a line that is not a PR row.
 */
const askPrList = async (
  scripts: Scripts,
  args: readonly string[],
  onCall: () => void,
): Promise<ScanListingAnswer> => {
  const said = await scripts.hostSaid(['pr-list', ...args]);
  onCall();
  if (said.answer === 'failed' || said.answer === 'unaskable') {
    return { verdict: 'failed', rows: [], stderr: said.said };
  }
  const rows = parseScanListingRows(said.stdout);
  if (rows === null) return { verdict: 'failed', rows: [], stderr: 'pr-list printed a line that is not a PR row' };
  return {
    verdict: said.answer === 'partial' ? 'partial' : 'ok',
    rows,
    stderr: said.answer === 'partial' ? said.said : said.stderr,
  };
};

/**
 * Reads the GitHub PR listing through the host, folded against the listing
 * the last host read held.
 *
 * Asks `pr-list --state open --rich` and `pr-list --state all`, both with
 * `--limit`, the second with `--since` where {@link scanListingWindowFor}
 * answers `delta`. A refused delta is asked again as a full read.
 *
 * @param scripts - the one place `plot-*.sh` is invoked.
 * @param held - the listing the last host read held, or null.
 * @param now - this machine's clock, in epoch milliseconds.
 * @param onCall - called once per real `pr-list` call made — the scan's own
 *   tally of requests spent, since a refused delta retries as a full read.
 * @returns the rendered listing and the listing to hold for the next read,
 *   or null where the full read was refused too or a row has no branch name.
 */
const readGithubListing = async (
  scripts: Scripts,
  held: CarriedListing | null,
  now: number,
  onCall: () => void,
): Promise<{ rendered: string; next: CarriedListing } | null> => {
  const limit = ['--limit', String(scanPrListLimit())];
  const attempt = async (window: ScanListingWindow, base: CarriedListing | null) => {
    const open = await askPrList(scripts, ['--state', 'open', ...limit, '--rich'], onCall);
    const since = window.kind === 'delta' ? ['--since', window.since] : [];
    const rest = await askPrList(scripts, ['--state', 'all', ...limit, ...since], onCall);
    return foldScanListing(base, open, rest);
  };

  let window = scanListingWindowFor(held, now, PR_FULL_READ_MS);
  let folded = await attempt(window, window.kind === 'delta' ? held : null);
  if (!folded.ok && window.kind === 'delta') {
    window = { kind: 'full' };
    folded = await attempt(window, null);
  }
  if (!folded.ok) return null;
  const rendered = renderScanListing(folded.rows, folded.complete);
  if (rendered === null) return null;
  return {
    rendered,
    next: {
      rows: folded.rows,
      complete: folded.complete,
      fullReadAt: window.kind === 'full' ? now : held?.fullReadAt ?? now,
    },
  };
};

/**
 * `bb_state_listing`/`bb_window_listing` page at this length — the unbranched
 * open call cannot claim a page whole at or above it, so {@link
 * readBitbucketListing} never trusts one that large as a delta's open half.
 */
const BB_LIST_PAGELEN = 50;

/**
 * Reads the Bitbucket PR listing through the host, folded against the listing
 * the last host read held — the sibling of {@link readGithubListing}.
 *
 * A full read sweeps every tracked branch (`pr-list --branch <name>...`,
 * dispatching to `bb_branch_sweep`); a delta asks one unbranched
 * `--state open --rich` plus one windowed `--state all --since`
 * (`bb_window_listing`). The open call is capped at {@link BB_LIST_PAGELEN}
 * minus one: a page that reads at the cap cannot prove itself whole (see
 * `pr_list_report_complete`'s `count < limit` test), so it carries no
 * whole-page notice and `foldScanListing` refuses it on its own — no count
 * check is needed here beyond the `--limit` that produces that refusal. A
 * refused delta is asked again as a full sweep, the same retry
 * {@link readGithubListing} makes.
 *
 * @param scripts - the one place `plot-*.sh` is invoked.
 * @param branches - the tracked branches a full read sweeps.
 * @param held - the listing the last host read held, or null.
 * @param now - this machine's clock, in epoch milliseconds — stamps the full
 *   read that lands, never consulted to re-derive `window`.
 * @param window - which read to attempt first, as `scanListingCost` was
 *   already told before this call was made.
 * @param onCall - called once per real `pr-list` call made — the scan's own
 *   tally of requests spent, since a refused delta retries as a full read.
 * @returns the rendered listing, the listing to hold for the next read, and
 *   the window actually read; or null where the full read was refused too or
 *   a row has no branch name.
 */
const readBitbucketListing = async (
  scripts: Scripts,
  branches: readonly string[],
  held: CarriedListing | null,
  now: number,
  window: ScanListingWindow,
  onCall: () => void,
): Promise<{ rendered: string; next: CarriedListing; window: ScanListingWindow } | null> => {
  const full = async (): Promise<ScanListingFold> => {
    const args = branches.flatMap((branch) => ['--branch', branch]);
    const open = await askPrList(scripts, ['--state', 'open', '--rich', ...args], onCall);
    const rest = await askPrList(scripts, ['--state', 'all', ...args], onCall);
    return foldScanListing(null, open, rest);
  };
  const delta = async (since: string): Promise<ScanListingFold> => {
    const open = await askPrList(scripts, ['--state', 'open', '--rich', '--limit', String(BB_LIST_PAGELEN - 1)], onCall);
    const rest = await askPrList(scripts, ['--state', 'all', '--since', since], onCall);
    return foldScanListing(held, open, rest);
  };

  let folded = window.kind === 'delta' ? await delta(window.since) : await full();
  if (!folded.ok && window.kind === 'delta') {
    window = { kind: 'full' };
    folded = await full();
  }
  if (!folded.ok) return null;
  const rendered = renderScanListing(folded.rows, folded.complete);
  if (rendered === null) return null;
  return {
    rendered,
    window,
    next: {
      rows: folded.rows,
      complete: folded.complete,
      fullReadAt: window.kind === 'full' ? now : held?.fullReadAt ?? now,
    },
  };
};

/**
 * Bounds a promise by a wall-clock budget.
 *
 * Nothing kills an in-process read, so the bound rejects and abandons it: the
 * abandoned reads finish on their own and write nothing.
 *
 * @param work - the promise to bound.
 * @param budgetMs - the budget in ms.
 * @returns the promise's value.
 * @throws where the budget runs out first, or `work` rejects.
 */
export const withinBudget = <T>(work: Promise<T>, budgetMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fleet scan timed out after ${budgetMs} ms`)), budgetMs);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });

const shortSha = async (refs: Refs, ref: string): Promise<string> => {
  const sha = await refs.resolve(ref);
  return sha.ok && sha.value !== '' ? sha.value.slice(0, 7) : 'unknown';
};

/**
 * Runs the plan walk's four stages in this process and builds the pulse.
 *
 * Fetches `origin` first, pruning, as the shell scan did; a failed fetch is
 * carried in the reading as `fetch_failed` and does not stop the walk. Every
 * read is cold: no stage's answer is kept between beats.
 *
 * Reads PR states from `listing` and never calls `Host.prList`. A listing that
 * {@link readCarriedPrStates} refuses, the empty one included, reads every PR
 * as `unreadable` with `hostReach` `failed`. The summary's `host` is the
 * branch stage's `hostReach`. After assembly, reads the conflicts of each
 * `wip` or `claimed` branch with a remote ref and changed paths, as
 * `plot-fleet-scan.sh` did.
 *
 * @param world - what the walk reads through.
 * @param listing - the rendered PR listing the scan carries, or `''` where none is held.
 * @returns the pulse.
 * @throws where a stage fails or the assembled document is not a pulse.
 */
export const walkOnce = async (world: ScanWorld, listing: string): Promise<FleetReading> => {
  const { scripts, refs, walk } = world;
  const cfg = async (key: string, fallback: string): Promise<string> => {
    const answer = await scripts.config(key, fallback);
    return answer.ok && answer.value.trim() !== '' ? answer.value.trim() : fallback;
  };
  const planDir = await cfg('Plan directory', 'docs/plans/');
  const activeDir = await cfg('Active index', 'docs/plans/active/');
  const deliveredDir = await cfg('Delivered index', 'docs/plans/delivered/');
  const prefixes = (await cfg('Branch prefixes', 'idea/, feature/, bug/, docs/, infra/'))
    .split(',').map((p) => p.trim().replace(/\/$/, '')).filter((p) => p !== '');
  const configured = await scripts.config('Main branch', '');
  let mainBranch = configured.ok ? configured.value.trim() : '';
  if (mainBranch === '') {
    const found = await refs.defaultBranch();
    mainBranch = found.ok && found.value !== '' ? found.value : 'main';
  }

  // `--prune` and the heads refspec ride after `origin`, where git reads them as
  // the shell scan's command did: the prune then covers the whole mirror.
  const fetched = await walk.trees.fetch(world.repoRoot, ['--prune', mainBranch, '+refs/heads/*:refs/remotes/origin/*']);
  const readRef = await shortSha(refs, `origin/${mainBranch}`);
  const localHead = await shortSha(refs, 'HEAD');

  const carried = readCarriedPrStates(listing);
  const prs: BranchStagePrs = carried === null ? { kind: 'unread' } : { kind: 'listed', listing: carried };
  const estate = await readEstate(refs, walk.plans(`origin/${mainBranch}`, planDir), {
    mainBranch, planDir, activeDir, deliveredDir, prefixes: prefixes.length > 0 ? prefixes : ['idea', 'feature', 'bug', 'docs', 'infra'],
  });
  const branches = estate.ok
    ? await readBranchReadings(refs, walk.host, estate.value, { mainBranch, planDir, prs })
    : estate;
  const desks = branches.ok
    ? await readDeskReadings(walk.trees, walk.agents, walk.processes, branches.value)
    : branches;
  const assembled = assemblePlanWalk(
    { estate, branches: branches as never, desks: desks as never },
    { slug: '', offer: false },
  );
  if (!assembled.ok) {
    const stage = !estate.ok ? 'estate' : !branches.ok ? 'branches' : !desks.ok ? 'desks' : 'assembly';
    throw new Error(`fleet scan: the ${stage} stage failed`);
  }
  const conflicts = await readBranchConflicts(
    refs,
    mainBranch,
    assembled.value.plans.flatMap((plan) => plan.slices.flatMap((slice) => slice.branches)),
  );
  const document = fleetReading(assembled.value, {
    main: mainBranch,
    readRef,
    localHead,
    fetchFailed: !fetched.ok,
    fetchError: fetched.ok ? '' : 'git fetch failed',
    planDir,
    host: branches.ok ? branches.value.hostReach : 'failed',
    mergeDetect: 'unaskable',
    nowSeconds: Math.floor(Date.now() / 1000),
  }, conflicts);
  const reading = FleetReadingSchema.safeParse(document);
  if (!reading.success) throw new Error('fleet scan: the walk produced a document that is not a pulse');
  return reading.data;
};

/**
 * Runs the fleet scan once and reads the facts that travel with its pulse.
 *
 * Spends the PR listing only where `listingSpend` permits and no listing
 * back-off is held, hands the scan the cost caches in `state`, and writes the
 * `terminal:`/`listing:` lines the scan streamed back into `state`. A
 * completed scan replaces `terminal` and, where it fetched, `listing`. A scan
 * that throws (budget timeout or failure) or ends without its reading merges
 * its streamed terminal rows into `terminal` by branch name, and replaces
 * `listing` only where the streamed listing ends with `.list-arrived`. On
 * both GitHub and Bitbucket a due listing is read through the host before the
 * scan starts; where that read succeeds, it replaces `listing`, `listingAt`,
 * `listingBranches` and `listingHeld`, and the scan's own `listing:` lines are
 * not adopted.
 *
 * A refused listing attempt (a null host read on either backend) opens or
 * grows a back-off on `state.backoffUntil`/`backoffMs`, bounded and
 * growing on repeat (`listingBackoff`). While it holds, the scan skips only
 * the host listing: it still runs every beat, hands the shell its carried
 * listing so the shell makes no per-branch `pr-state --ask` call, and still
 * writes the bridge — the back-off never stops the scan itself. The next
 * adopted listing clears the back-off, so the refusal after a success starts
 * from the base again.
 *
 * @param world - what the scan reads through.
 * @param state - the caches carried between scans; `terminal`, `listing`,
 *   `listingAt` and `listingBranches` are mutated as above, on success or
 *   throw; `listingIntervalMs`, `listingReusedAgeMs`, `backoffUntil` and
 *   `backoffMs` record the verdict.
 * @param options - whether the script records, and a hook on every raw line.
 * @returns the pulse and the facts read beside it.
 * @throws where the scan fails, times out, or ends without its terminal line.
 */
export const scanOnce = async (
  world: ScanWorld,
  state: ScanState,
  _options: ScanOptions,
): Promise<ScanResult> => {
  const now = Date.now();
  const due = state.listingAt === null || now >= state.listingAt + state.listingIntervalMs;
  const backoff = listingBackoff({ backoffUntil: state.backoffUntil, backoffMs: state.backoffMs, now });
  let spend = true;
  let reusedAgeMs: number | null = null;
  let backend: string | null = null;
  let bitbucketWindow: ScanListingWindow = { kind: 'full' };
  if (due && backoff.open) {
    backend = await world.backend();
    if (backend === 'bitbucket') bitbucketWindow = scanListingWindowFor(state.listingHeld, now, PR_FULL_READ_MS);
    const verdict = listingSpend({
      intervalMs: LISTING_REFRESH_MS,
      costPerListing: scanListingCost(
        backend,
        state.listingBranches,
        state.listing === '' ? null : listedRowCount(state.listing),
        bitbucketWindow,
      ),
      rate: await spendRateFor(world.scripts),
      lastListedAt: state.listingAt,
      now,
      currentIntervalMs: state.listingIntervalMs,
    });
    state.listingIntervalMs = verdict.intervalMs;
    spend = verdict.spend;
    reusedAgeMs = verdict.reuse?.ageMs ?? null;
  } else {
    reusedAgeMs = Math.max(0, now - (state.listingAt ?? now));
    spend = false;
  }
  const reusing = !spend && state.listing !== '';
  state.listingReusedAgeMs = reusing ? reusedAgeMs : null;

  // ON GITHUB AND BITBUCKET, A DUE SPEND READS THE LISTING ITSELF rather than
  // leaving `PLOT_PR_LISTING` empty for the shell to fetch — `PLOT_PR_LISTING`
  // must never be handed to the shell empty here. A Bitbucket FULL read still
  // needs `TRACKED_BRANCHES`: `world.refs.listBranches(true)` is the domain
  // port's declared duplicate of the shell's own computation
  // (`corpus/tracked-branches.corpus.test.ts` holds the two to agreement), so
  // a full read no longer needs the shell subprocess to name its working set.
  //
  // A SUCCESSFUL HOST READ IS ADOPTED HERE, not from the scan's `listing:`
  // lines: the shell carries a handed listing and reports none back.
  let hostRead: { rendered: string; next: CarriedListing } | null = null;
  let listingRefused = false;
  if (spend && backend === 'github') {
    hostRead = await readGithubListing(world.scripts, state.listingHeld, now, () => {
      state.calls += 1;
    });
    state.listingHeld = hostRead?.next ?? null;
    if (hostRead !== null) {
      state.listing = hostRead.rendered;
      state.listingAt = Date.now();
      state.listingBranches = listedBranchCount(hostRead.rendered) ?? state.listingBranches;
    } else {
      listingRefused = true;
    }
  } else if (spend && backend === 'bitbucket') {
    const tracked = await world.refs.listBranches(true);
    const branches = tracked.ok ? tracked.value : [];
    const read = await readBitbucketListing(world.scripts, branches, state.listingHeld, now, bitbucketWindow, () => {
      state.calls += 1;
    });
    state.listingHeld = read?.next ?? null;
    if (read !== null) {
      hostRead = read;
      state.listing = read.rendered;
      state.listingAt = Date.now();
      state.listingBranches = branches.length;
    } else {
      listingRefused = true;
    }
  }

  // THE WALK RUNS IN THIS PROCESS. A failure or an exhausted budget throws, so
  // `writeScan` never runs for the beat and the bridge keeps its last good write.
  // The walk reads PR states from `state.listing` and asks the host nothing, so
  // the listing read above is the beat's only host spend and the back-off holds.
  // The back-off below is settled either way: it concerns the listing read above,
  // not the walk.
  let parsed: FleetReading;
  try {
    parsed = await withinBudget(walkOnce(world, state.listing), FLEET_SCAN_BUDGET_MS);
  } finally {
    // A SPEND ATTEMPT THAT DID NOT ADOPT THROUGH THE HOST REFUSED. Both
    // backends read their listing host-side. A reused or backed-off pass spent
    // nothing and neither opens nor clears the back-off.
    if (spend) {
      if (listingRefused) {
        state.backoffUntil = now + backoff.onRefusalMs;
        state.backoffMs = backoff.onRefusalMs;
      } else {
        state.backoffUntil = null;
        state.backoffMs = null;
      }
    }
  }
  const reading: FleetReading = parsed;
  const { ages, tipAt } = await branchAges(world.refs);
  return {
    reading,
    ages,
    tipAt,
    branchUrlBase: await readBranchUrlBase(world.refs),
    approvedAt: await approvalDates(world, reading),
    ideaPlans: await ideaPlanFiles(world),
  };
};

/**
 * Writes a scan's result to the bridge.
 *
 * Called after `scanOnce` returned and never after it threw, so a failed scan
 * leaves the last good bridge byte-identical. Carries all six fields: the
 * script's own write, which a `record` scan leaves thin, is replaced by this one.
 *
 * @param fleetState - the bridge port.
 * @param result - what the scan read.
 * @param at - epoch ms the scan completed.
 * @param prError - the fleet's last PR-read failure sentence, or `null`.
 * @param startedAt - epoch ms the attempt started; defaults to `at`.
 * @returns whether the write landed.
 */
export const writeScan = async (
  fleetState: FleetState,
  result: ScanResult,
  at: number,
  prError: string | null,
  startedAt: number = at,
): Promise<boolean> => {
  const written = await fleetState.write({
    at,
    pulse: result.reading,
    ages: result.ages,
    branchUrlBase: result.branchUrlBase,
    approvedAt: result.approvedAt,
    ideaPlans: result.ideaPlans,
    prError,
    attempt: { startedAt, endedAt: at, outcome: 'ok', error: null },
  });
  return written.ok;
};
