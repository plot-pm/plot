import path from 'node:path';

import { FleetReadingSchema, type FleetReading } from '@plot-pm/domain/entities/fleet';
import { deskReadsOf, listingBackoff, listingChange, listingSpend, PR_READ_BEAT_MS, type ScanPlan, type SnapshotChange } from '@plot-pm/domain';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Agents } from '@plot-pm/domain/ports/agents';
import type { Host, PrListingQuery } from '@plot-pm/domain/ports/host';
import type { PlanStore } from '@plot-pm/domain/ports/plan-store';
import type { Processes } from '@plot-pm/domain/ports/processes';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { readBranchConflicts, readBranchReadings, type BranchStagePrs, type BranchStageReadings } from '@plot-pm/domain/workflows/plan-walk-branches';
import { readDeskReadings, type DeskStageReadings } from '@plot-pm/domain/workflows/plan-walk-desks';
import { readEstate, type Estate } from '@plot-pm/domain/workflows/plan-walk-estate';
import { readBranchPlans, readDeliveredInputs, readSprints, readStories } from '@plot-pm/domain/workflows/board-card-reads';
import { resolveRecordRef, type RecordSource } from '@plot-pm/domain/workflows/record-listing';
import { STORY_LEGACY_ISSUE_KEY } from '@plot-pm/domain/adapters/story-front-matter';
import type { PortResult } from '@plot-pm/domain';
import { cachedPlans, cachedRefs, freshWalkCache, readRefSnapshot, type WalkCache } from '@plot-pm/domain/workflows/plan-walk-cache';
import { assemblePlanWalk, fleetReading } from '@plot-pm/domain/workflows/plan-walk-assembly';
import { branchAgesOf, walkValueOf, type WalkHeader } from '@plot-pm/domain/workflows/board-view';
import { readReleaseVersions, readUnmerged } from '@plot-pm/domain/workflows/board-reads';
import type { FleetState } from '@plot-pm/domain/ports/fleet-state';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import { indexMergedHeads, indexOpenHeads } from '@plot-pm/domain/rules/known-pr';
import { githubListingPages } from '@plot-pm/domain/rules/listing-page';
import { branchUrlBase as branchUrlBaseOf } from '@plot-pm/domain/rules/branch-url';
import { HOST_BRANCH_URL_SCHEMES } from '@plot-pm/domain/adapters/host/host-branch-urls';
import {
  foldScanListing, readCarriedPrStates, renderScanListing, scanListingRowsOf, scanListingWindowFor,
  type CarriedListing, type ScanListingAnswer, type ScanListingFold, type ScanListingWindow,
} from '@plot-pm/domain/rules/scan-listing';
import { PR_FULL_READ_MS } from './pr-refresh.js';
import type { SpendRate, SpendReader } from './spend-reader.js';
import { failedOf, readOf, type RecordReading } from './snapshot-fill.js';
import { workerQuestions } from './worker-question.js';
import { freshDeskHold, holdDeskReads, type DeskHold } from './desk-hold.js';

/** The scan Plot ships, streamed one plan at a time. */
/** The branch-URL prefix for an origin URL, over the hosts Plot drives. */
export const branchUrlBase = (origin: string): string => branchUrlBaseOf(origin, HOST_BRANCH_URL_SCHEMES);

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
   * the in-process `askPrListing` calls plus the shell's own reported `spend:`
   * count. Never reset at the top of a pass; only the reader zeroes it.
   */
  calls: number;
  /**
   * The walk's oid-keyed answers, held in this process only. Never written to
   * a file or the environment: `plot-dispatch.sh --list-eligible` runs cold.
   * Absent, the walk runs cold every beat, as the board's fallback does.
   */
  walkCache?: WalkCache;
  /** The desk reads held between scans, in this process only; absent, every desk is read each scan. */
  deskHold?: DeskHold;
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
  walkCache: freshWalkCache(),
  deskHold: freshDeskHold(),
});

/** What a scan reads through; every spawn goes through `scripts` or `refs`. */
export interface ScanWorld {
  repoRoot: string;
  scripts: Scripts;
  refs: Refs;
  /** The configured git host's name, e.g. `github`. */
  backend: () => Promise<string>;
  /** Reads the host's spend for the listing's cadence; `plot-host.sh spend-rate` where absent. */
  spend?: SpendReader;
  /** The ports the in-process plan walk reads through. */
  walk: WalkPorts;
  /**
   * Records what the walk reads into the daemon's snapshot: `config`, `refs`,
   * `plans`, `desks`, `deskFiles` and `workers`. Absent, the walk records
   * nothing. It adds no read.
   */
  record?: RecordReading;
  /**
   * Receives the branch and desk stages of every walk whose desks answered;
   * fleetd writes the AgentMonitor's findings here. Absent, nothing receives them.
   */
  findings?: (branches: BranchStageReadings, desks: DeskStageReadings) => Promise<void>;
  /**
   * Receives a change the scan's own read found: a listing that names a branch
   * that appeared or went away, or a newly merged PR, raises `remote`. Absent,
   * the scan raises none.
   */
  raise?: (change: SnapshotChange) => void;
}

/** The ports the plan walk reads through, beside `refs` and `scripts`. */
export interface WalkPorts {
  host: Host;
  /** Builds the plan store over a ref and the plan directory. */
  plans: (ref: string, planDir: string) => PlanStore;
  /** The plan store over the checkout, read where `origin/<main>` does not resolve. */
  worktree: PlanStore;
  trees: Trees;
  agents: Agents;
  processes: Processes;
  /** Absolute path of `plot-plan-meta.sh`; absent, no parse is cached. */
  parser?: string;
  /**
   * The PR index's rows for the configured backend, read from the file and
   * never from the host; empty where no index is held. Absent, the walk
   * reads no index.
   */
  prIndexRows?: () => Promise<readonly PrIndexRow[]>;
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
  /**
   * What this scan reads, from the trigger. Absent, the scan reads every
   * reading and fetches, as every scan did before a trigger started it.
   */
  plan?: ScanPlan;
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

export type { SpendRate, SpendReader } from './spend-reader.js';

/**
 * Asks `plot-host.sh spend-rate` what this account has spent. A world with no
 * `spend` reader reads through this.
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


/**
 * Minutes since each remote branch's tip commit, and the tip's epoch ms.
 *
 * @param refs - the refs port.
 * @returns both maps; empty where the refs cannot be read.
 */
export const branchAges = async (
  refs: Refs,
): Promise<{ ages: Map<string, number | null>; tipAt: Map<string, number | null> }> =>
  branchAgesOf((await readBranchDates(refs)) ?? [], Date.now());

/**
 * Each remote branch's tip commit time, epoch seconds.
 *
 * @param refs - the refs port.
 * @returns the dates, or null where the refs cannot be read.
 */
const readBranchDates = async (refs: Refs): Promise<{ branch: string; committedAt: number }[] | null> => {
  try {
    const dates = await refs.branchDates(['refs/remotes/origin']);
    return dates.ok ? dates.value.map(({ branch, committedAt }) => ({ branch, committedAt })) : null;
  } catch {
    return null;
  }
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
): Promise<Map<string, string>> => (await readIdeaPlans(world)) ?? new Map();

/**
 * The plan file each idea branch carries, or null where the idea branches
 * cannot be listed.
 */
const readIdeaPlans = async (
  world: Pick<ScanWorld, 'refs' | 'scripts'>,
): Promise<Map<string, string> | null> => {
  const found = new Map<string, string>();
  try {
    const planDir = await planDirectory(world.scripts);
    const tips = await world.refs.branchTips(['refs/remotes/origin/idea/*']);
    if (!tips.ok) return null;
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
 * Asks the host one typed listing and reads it into rows. Both listings
 * ask this way.
 *
 * @param host - the git host connector.
 * @param query - the listing query.
 * @param onCall - called once the host has answered, win or lose, with the
 *   refusal's words where it refused.
 * @returns the rows and the asked state's completeness word, or
 *   `verdict: 'failed'` with no rows where the call failed, could not be
 *   asked, or listed a row with no head or state.
 */
const askPrListing = async (
  host: Host,
  query: PrListingQuery,
  onCall: (refusal?: string) => void,
): Promise<ScanListingAnswer> => {
  const listing = await host.prListing(query);
  if (listing.answer === 'failed' || listing.answer === 'unaskable') {
    onCall(listing.refusal?.said ?? 'pr-list failed and said nothing');
    return { verdict: 'failed', rows: [], complete: 'possibly-truncated' };
  }
  onCall();
  const rows = scanListingRowsOf(listing.rows);
  if (rows === null) return { verdict: 'failed', rows: [], complete: 'possibly-truncated' };
  return {
    verdict: listing.answer === 'partial' ? 'partial' : 'ok',
    rows,
    complete: listing.complete[query.state] ?? 'possibly-truncated',
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
 * @param host - the git host connector.
 * @param held - the listing the last host read held, or null.
 * @param now - this machine's clock, in epoch milliseconds.
 * @param onCall - called once per real `pr-list` call made — the scan's own
 *   tally of requests spent, since a refused delta retries as a full read.
 * @returns the rendered listing and the listing to hold for the next read,
 *   or null where the full read was refused too or a row has no branch name.
 */
const readGithubListing = async (
  host: Host,
  held: CarriedListing | null,
  now: number,
  onCall: (refusal?: string) => void,
): Promise<{ rendered: string; next: CarriedListing } | null> => {
  const limit = scanPrListLimit();
  const attempt = async (window: ScanListingWindow, base: CarriedListing | null) => {
    const open = await askPrListing(host, { state: 'open', limit, rich: true }, onCall);
    const since = window.kind === 'delta' ? { since: window.since } : {};
    const rest = await askPrListing(host, { state: 'all', limit, ...since }, onCall);
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
 * @param host - the git host connector.
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
  host: Host,
  branches: readonly string[],
  held: CarriedListing | null,
  now: number,
  window: ScanListingWindow,
  onCall: (refusal?: string) => void,
): Promise<{ rendered: string; next: CarriedListing; window: ScanListingWindow } | null> => {
  const full = async (): Promise<ScanListingFold> => {
    const open = await askPrListing(host, { state: 'open', rich: true, branches }, onCall);
    const rest = await askPrListing(host, { state: 'all', branches }, onCall);
    return foldScanListing(null, open, rest);
  };
  const delta = async (since: string): Promise<ScanListingFold> => {
    const open = await askPrListing(host, { state: 'open', rich: true, limit: BB_LIST_PAGELEN - 1 }, onCall);
    const rest = await askPrListing(host, { state: 'all', since }, onCall);
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

/** What {@link recordCardReadings} reads beside the walk's ports. */
interface CardReadingsInput {
  mainBranch: string;
  planDir: string;
  sprintDir: string;
  storyDir: string;
  prefixes: readonly string[];
  recordSource: RecordSource;
}

/**
 * Records `plans` with its authors and Delivered inputs, and the `branchPlans`,
 * `sprints` and `stories` readings, through the walk's cached refs and plan
 * store. Where the estate came from the checkout, every reading the default
 * branch answers is recorded failed.
 */
const recordCardReadings = async (
  record: RecordReading,
  refs: Refs,
  plansAt: PlanStore,
  estate: PortResult<Estate>,
  input: CardReadingsInput,
): Promise<void> => {
  if (!estate.ok) {
    for (const key of ['plans', 'branchPlans', 'sprints', 'stories'] as const) record(key, failedOf('the estate stage failed'));
    return;
  }
  const records = estate.value.plans.map((plan) => plan.record);
  if (estate.value.source === 'worktree') {
    const why = `origin/${input.mainBranch} did not resolve, so the plans were read from the checkout`;
    record('plans', readOf({
      ref: 'worktree',
      resolved: '',
      records,
      authors: { state: 'failed', reason: why },
      delivered: { state: 'failed', reason: why },
    }));
    for (const key of ['branchPlans', 'sprints', 'stories'] as const) record(key, failedOf(why));
    return;
  }
  const main = `origin/${input.mainBranch}`;
  const authors = await refs.planAuthors(main, input.planDir);
  const recordRef = (await resolveRecordRef(refs, input.recordSource)).ref;
  const delivered = await readDeliveredInputs(refs, estate.value.plans.map(({ blob, record: r }) => ({ record: r, sha: blob.sha })), recordRef);
  record('plans', readOf({
    ref: main,
    resolved: estate.value.mainSha,
    records,
    authors: authors.ok ? { state: 'read', value: Object.fromEntries(authors.value) } : { state: 'failed', reason: 'the plan authors could not be read' },
    delivered: delivered.ok ? { state: 'read', value: delivered.value } : { state: 'failed', reason: 'the Delivered plans could not be read' },
  }));
  const branchPlans = await readBranchPlans(refs, plansAt, { ...input, mainSha: estate.value.mainSha });
  record('branchPlans', branchPlans.ok ? readOf(branchPlans.value) : failedOf('the branch plans could not be read'));
  const sprints = await readSprints(refs, main, input.sprintDir);
  record('sprints', sprints.ok ? readOf(sprints.value) : failedOf('the sprint files could not be read'));
  const stories = await readStories(refs, main, input.storyDir, STORY_LEGACY_ISSUE_KEY);
  record('stories', stories.ok ? readOf(stories.value) : failedOf('the story files could not be read'));
};

/**
 * Runs the plan walk's four stages in this process and builds the pulse.
 *
 * Fetches `origin` first, pruning, as the shell scan did, unless `held.plan`
 * says no remote change named it; a failed fetch is carried in the reading as
 * `fetch_failed` and does not stop the walk. A `held` plan that names desks
 * reads their git status again and answers the other desks from `held.hold`.
 * Without `held`, every read is cold.
 *
 * Reads PR states from `listing` and never calls `Host.prList`. Reads the PR
 * index's merged rows through `walk.prIndexRows`, which confirm a refless
 * branch a merge subject or a landed commit proves. A listing that
 * {@link readCarriedPrStates} refuses, the empty one included, reads every PR
 * as `unreadable` with `hostReach` `failed`. The summary's `host` is the
 * branch stage's `hostReach`. After assembly, reads the conflicts of each
 * `wip` or `claimed` branch with a remote ref and changed paths, as
 * `plot-fleet-scan.sh` did.
 *
 * @param world - what the walk reads through.
 * @param listing - the rendered PR listing the scan carries, or `''` where none is held.
 * @param listingSaid - what the host said when the listing read was refused, or `''`; a host that could not be asked reads `unasked` rather than `failed`.
 * @param cache - the oid-keyed answers held between walks.
 * @param held - the trigger's plan and the desk reads held between walks.
 * @returns the pulse.
 * @throws where a stage fails or the assembled document is not a pulse.
 */
export const walkOnce = async (
  world: ScanWorld,
  listing: string,
  listingSaid = '',
  cache?: WalkCache,
  held?: { plan: ScanPlan; hold: DeskHold },
): Promise<FleetReading> => {
  const { scripts, record } = world;
  let refs = world.refs;
  const configRead: Record<string, string> = {};
  const configFailed: string[] = [];
  const cfg = async (key: string, fallback: string): Promise<string> => {
    const answer = await scripts.config(key, fallback);
    if (answer.ok) configRead[key] = answer.value.trim();
    else configFailed.push(key);
    return answer.ok && answer.value.trim() !== '' ? answer.value.trim() : fallback;
  };
  // THE LISTING `readDeskReadings` TAKES IS THE `desks` READING: tapped, never asked twice.
  let listed = false;
  const walk: WalkPorts = record === undefined ? world.walk : {
    ...world.walk,
    trees: {
      ...world.walk.trees,
      list: async () => {
        const answer = await world.walk.trees.list();
        listed = true;
        record('desks', answer.ok ? readOf(answer.value.map((tree) => ({ ...tree }))) : failedOf('the worktree listing failed'));
        return answer;
      },
    },
  };
  const planDir = await cfg('Plan directory', 'docs/plans/');
  const activeDir = await cfg('Active index', 'docs/plans/active/');
  const deliveredDir = await cfg('Delivered index', 'docs/plans/delivered/');
  const tracker = await cfg('Tracker', '');
  const prefixes = (await cfg('Branch prefixes', 'idea/, feature/, bug/, docs/, infra/'))
    .split(',').map((p) => p.trim().replace(/\/$/, '')).filter((p) => p !== '');
  const stateBranch = await cfg('State branch', '');
  // Read only where the walk records: the sprint and story readings are the board's.
  const sprintDir = record === undefined ? '' : await cfg('Sprint directory', 'docs/sprints/');
  const storyDir = record === undefined ? '' : await cfg('Story directory', 'docs/stories/');
  const configured = await scripts.config('Main branch', '');
  if (configured.ok) configRead['Main branch'] = configured.value.trim();
  else configFailed.push('Main branch');
  record?.('config', configFailed.length === 0 ? readOf({ ...configRead }) : failedOf(`the config read failed for ${configFailed.join(', ')}`));
  let mainBranch = configured.ok ? configured.value.trim() : '';
  if (mainBranch === '') {
    const found = await refs.defaultBranch();
    mainBranch = found.ok && found.value !== '' ? found.value : 'main';
  }

  // `--prune` and the heads refspec ride after `origin`, where git reads them as
  // the shell scan's command did: the prune then covers the whole mirror.
  const fetched = held !== undefined && !held.plan.fetch
    ? { ok: true as const }
    : await walk.trees.fetch(world.repoRoot, ['--prune', mainBranch, '+refs/heads/*:refs/remotes/origin/*']);

  // THE SNAPSHOT IS READ ONCE, AFTER THE FETCH AND BEFORE ANY CACHED READ. Every
  // cached read below resolves its names through it, so a ref that moves later
  // in the beat moves no key. A snapshot git cannot give runs the beat cold.
  const snapshot = cache === undefined ? null : await readRefSnapshot(refs);
  if (snapshot !== null) {
    record?.('refs', snapshot.ok ? readOf({ entries: snapshot.value.entries, digest: snapshot.value.digest }) : failedOf('the refs could not be listed'));
  }
  let plansAt = walk.plans(`origin/${mainBranch}`, planDir);
  if (cache !== undefined && snapshot !== null && snapshot.ok) {
    cache.begin();
    cache.stats.beats += 1;
    if (cache.lastSnapshot !== null && cache.lastSnapshot !== snapshot.value.digest) cache.stats.changedBeats += 1;
    cache.lastSnapshot = snapshot.value.digest;
    refs = cachedRefs(refs, snapshot.value, cache);
    // The parser file is hashed on disk every beat, not versioned in this bundle:
    // a fast-forward of main changes the script while this process keeps running.
    const parser = walk.parser !== undefined && typeof refs.hashFilesSync === 'function' ? refs.hashFilesSync([walk.parser]) : null;
    const parserHash = parser !== null && parser.ok ? parser.value.get(walk.parser!) : undefined;
    if (parserHash !== undefined) {
      const digest = [mainBranch, planDir, activeDir, deliveredDir, prefixes.join('|'), tracker].join('\n');
      plansAt = cachedPlans(plansAt, cache, `${parserHash}\0${digest}`);
    }
  } else if (cache !== undefined) {
    cache.lastSnapshot = null;
  }
  const readRef = await shortSha(refs, `origin/${mainBranch}`);
  const localHead = await shortSha(refs, 'HEAD');

  const carried = readCarriedPrStates(listing);
  const prs: BranchStagePrs = carried === null ? { kind: 'unread', said: listingSaid } : { kind: 'listed', listing: carried };
  // A reused listing can lack a PR merged since it was read, or still carry its
  // OPEN row; the index's MERGED rows confirm a subject-proven branch, its own
  // OPEN rows decide whether a second PR holds the name, and its silence
  // decides nothing.
  const indexRows = walk.prIndexRows === undefined ? null : await walk.prIndexRows();
  const indexMerged = indexMergedHeads(indexRows ?? []);
  const indexOpen = indexRows === null ? undefined : indexOpenHeads(indexRows);
  const estate = await readEstate(refs, plansAt, {
    mainBranch, stateBranch, planDir, activeDir, deliveredDir, prefixes: prefixes.length > 0 ? prefixes : ['idea', 'feature', 'bug', 'docs', 'infra'],
  }, walk.worktree);
  if (record !== undefined) {
    await recordCardReadings(record, refs, plansAt, estate, {
      mainBranch,
      planDir,
      sprintDir,
      storyDir,
      prefixes: prefixes.length > 0 ? prefixes : ['idea', 'feature', 'bug', 'docs', 'infra'],
      recordSource: { stateBranch, defaultBranch: mainBranch },
    });
  }
  const branches = estate.ok
    ? await readBranchReadings(refs, walk.host, estate.value, { mainBranch, planDir, prs, indexMerged, ...(indexOpen === undefined ? {} : { indexOpen }) })
    : estate;
  const desks = branches.ok
    ? await readDeskReadings(
      held === undefined ? walk.trees : holdDeskReads(walk.trees, held.hold, deskReadsOf(held.plan.readings), Date.now()),
      walk.agents,
      walk.processes,
      branches.value,
    )
    : branches;
  if (world.findings !== undefined && branches.ok && desks.ok) await world.findings(branches.value, desks.value);
  if (record !== undefined) {
    if (!listed) record('desks', failedOf(`the desk stage did not run: the ${!estate.ok ? 'estate' : 'branches'} stage failed`));
    if (desks.ok) {
      record('deskFiles', readOf(Object.fromEntries(desks.value.desks.map((each) => [each.worktree, each.desk]))));
      record('workers', readOf(Object.fromEntries(desks.value.desks.map((each) => [each.worktree, each.process]))));
    } else {
      const why = `the desk stage did not answer: the ${!estate.ok ? 'estate' : !branches.ok ? 'branches' : 'desks'} stage failed`;
      record('deskFiles', failedOf(why));
      record('workers', failedOf(why));
    }
  }
  const assembled = assemblePlanWalk(
    { estate, branches: branches as never, desks: desks as never },
    { slug: '', offer: false },
  );
  if (!assembled.ok) {
    const stage = !estate.ok ? 'estate' : !branches.ok ? 'branches' : !desks.ok ? 'desks' : 'assembly';
    record?.('walk', failedOf(`the ${stage} stage failed`));
    throw new Error(`fleet scan: the ${stage} stage failed`);
  }
  const conflicts = await readBranchConflicts(
    refs,
    mainBranch,
    assembled.value.plans.flatMap((plan) => plan.slices.flatMap((slice) => slice.branches)),
  );
  const header: WalkHeader = {
    main: mainBranch,
    readRef,
    localHead,
    fetchFailed: !fetched.ok,
    fetchError: fetched.ok ? '' : 'git fetch failed',
    planDir,
    mergeDetect: 'unaskable',
    nowSeconds: Math.floor(Date.now() / 1000),
  };
  const document = fleetReading(assembled.value, {
    ...header,
    host: branches.ok ? branches.value.hostReach : 'failed',
    planSource: estate.ok && estate.value.source === 'worktree' ? 'worktree' : 'ref',
  }, conflicts);
  const reading = FleetReadingSchema.safeParse(document);
  if (!reading.success) {
    record?.('walk', failedOf('the walk produced a document that is not a pulse'));
    throw new Error('fleet scan: the walk produced a document that is not a pulse');
  }
  if (record !== undefined && estate.ok && branches.ok && desks.ok) {
    record('walk', readOf(walkValueOf(estate.value, branches.value, desks.value, conflicts, header)));
    // THE BOARD'S OWN DISPLAY READS, taken here through the walk's cached refs:
    // an unchanged ref answers from the cache and starts no process.
    const versions = await readReleaseVersions(refs);
    record('releaseVersions', versions.ok ? readOf(versions.value) : failedOf('the release branches could not be listed'));
    const unmerged = await readUnmerged(refs, mainBranch);
    record('unmerged', unmerged.ok ? readOf(unmerged.value) : failedOf('the remote branches could not be listed'));
  }
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
  options: ScanOptions,
): Promise<ScanResult> => {
  const now = Date.now();
  const heldListing = state.listing;
  const due = options.plan?.listing === true || state.listingAt === null || now >= state.listingAt + state.listingIntervalMs;
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
      rate: await (world.spend ?? (() => spendRateFor(world.scripts)))(),
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
  let listingSaid = '';
  const counted = (refusal?: string): void => {
    state.calls += 1;
    if (refusal !== undefined) listingSaid = refusal;
  };
  if (spend && backend === 'github') {
    hostRead = await readGithubListing(world.walk.host, state.listingHeld, now, counted);
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
    const read = await readBitbucketListing(world.walk.host, branches, state.listingHeld, now, bitbucketWindow, counted);
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
    const held = options.plan === undefined || state.deskHold === undefined ? undefined : { plan: options.plan, hold: state.deskHold };
    parsed = await withinBudget(walkOnce(world, state.listing, listingSaid, state.walkCache, held), FLEET_SCAN_BUDGET_MS);
    // Pruned only here, after a beat that completed: a beat that timed out
    // keeps what it read, so the next one does not start cold again.
    state.walkCache?.sweep();
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
  // A LISTING THAT MOVED A REF RAISES `remote`; one that changed only a CI answer raises nothing.
  if (hostRead !== null && listingChange(heldListing, state.listing).remote) world.raise?.({ kind: 'remote' });
  const dates = await readBranchDates(world.refs);
  world.record?.('branchDates', dates === null ? failedOf('the branch dates could not be read') : readOf(dates));
  const { ages, tipAt } = branchAgesOf(dates ?? [], Date.now());
  const ideaPlans = await readIdeaPlans(world);
  world.record?.('ideaPlans', ideaPlans === null ? failedOf('the idea branches could not be listed') : readOf(Object.fromEntries(ideaPlans)));
  if (world.record !== undefined) {
    const questions = await workerQuestions(reading, world.repoRoot);
    world.record('questions', readOf(Object.fromEntries(questions)));
  }
  return {
    reading,
    ages,
    tipAt,
    branchUrlBase: await readBranchUrlBase(world.refs),
    approvedAt: await approvalDates(world, reading),
    ideaPlans: ideaPlans ?? new Map(),
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
