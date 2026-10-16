import path from 'node:path';

import { FleetReadingSchema, type FleetReading } from '@plot-pm/domain/entities/fleet';
import { listingSpend, type LimitBasis } from '@plot-pm/domain';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { FleetState } from '@plot-pm/domain/ports/fleet-state';

/** The scan Plot ships, streamed one plan at a time. */
export const FLEET_SCAN = 'plot-fleet-scan.sh';

/** The pulse's base beat, in ms. The scan takes every beat. */
export const REFRESH_MS = 5_000;

/** The PR reader's cadence, in ms. It takes every twelfth beat. */
export const PR_REFRESH_MS = 60_000;

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
  listingIntervalMs: REFRESH_MS,
  listingBranches: 0,
  listingReusedAgeMs: null,
});

/** What a scan reads through; every spawn goes through `scripts` or `refs`. */
export interface ScanWorld {
  repoRoot: string;
  scripts: Scripts;
  refs: Refs;
  /** The configured git host's name, e.g. `github`. */
  backend: () => Promise<string>;
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
   * Whether the scan script records its own bridge. `false` sets
   * `PLOT_SCAN_RECORD=0`: the caller is not the fleet's writer.
   */
  record: boolean;
  /** Every raw stdout line, before the terminal one is parsed. */
  onLine?: (line: string) => void;
}

/**
 * Requests one fleet-scan listing spends on `backend`.
 *
 * GitHub answers in one request. Bitbucket asks its REST endpoint about each
 * tracked branch under three states, so the cost is `branches x 3`.
 *
 * @param backend - the configured host.
 * @param branches - how many branches the scan tracks.
 * @returns the requests one listing spends; never 0.
 */
export const scanListingCost = (backend: string, branches: number): number => {
  if (backend !== 'bitbucket') return 1;
  const swept = Math.max(0, Math.trunc(branches)) * 3;
  return swept > 0 ? swept : 3;
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
  // Three shapes: `https://[user@]host[:port]/path`, `ssh://user@host[:port]/path`
  // (the port is dropped, so `altssh.bitbucket.org:443` reads as a host and not
  // as a path segment), and scp-style `user@host:path`.
  const m = /^(?:https?:\/\/(?:[^@/]*@)?([^/]+)\/|ssh:\/\/(?:[^@/]+@)([^:/]+)(?::\d+)?\/|(?:[^@/:]+@)([^:/]+):)(.+?)(?:\.git)?\/?$/
    .exec(trimmed);
  if (!m) return '';
  const host = (m[1] ?? m[2] ?? m[3]).replace(/:\d+$/, '');
  const repoPath = m[4];
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

/**
 * Runs the fleet scan once and reads the facts that travel with its pulse.
 *
 * Spends the PR listing only where `listingSpend` permits, hands the scan the
 * two cost caches in `state`, and writes the `terminal:`/`listing:` lines the
 * scan streamed back into `state`. A completed scan replaces `terminal` and,
 * where it fetched, `listing`. A scan that throws (budget timeout or failure)
 * or ends without its reading merges its streamed terminal rows into `terminal` by branch name, and
 * replaces `listing` only where the streamed listing ends with `.list-arrived`.
 *
 * @param world - what the scan reads through.
 * @param state - the caches carried between scans; `terminal`, `listing`,
 *   `listingAt` and `listingBranches` are mutated as above, on success or
 *   throw; `listingIntervalMs` and `listingReusedAgeMs` record the verdict.
 * @param options - whether the script records, and a hook on every raw line.
 * @returns the pulse and the facts read beside it.
 * @throws where the scan fails, times out, or ends without its terminal line.
 */
export const scanOnce = async (
  world: ScanWorld,
  state: ScanState,
  options: ScanOptions,
): Promise<ScanResult> => {
  let parsed: FleetReading | null = null;
  let learned = '';
  let listed = '';
  const now = Date.now();
  const due = state.listingAt === null || now >= state.listingAt + state.listingIntervalMs;
  let spend = true;
  let reusedAgeMs: number | null = null;
  if (due) {
    const backend = await world.backend();
    const verdict = listingSpend({
      intervalMs: REFRESH_MS,
      costPerListing: scanListingCost(backend, state.listingBranches),
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
  let ended = false;
  try {
    await world.scripts.stream(FLEET_SCAN, ['--stream'],
      (line) => {
        options.onLine?.(line);
        let msg: { kind?: unknown; reading?: unknown };
        try {
          msg = JSON.parse(line) as typeof msg;
        } catch {
          return;
        }
        if (msg.kind !== 'reading') return;
        const reading = FleetReadingSchema.safeParse(msg.reading);
        if (reading.success) parsed = reading.data;
      },
      {
        timeoutMs: FLEET_SCAN_BUDGET_MS,
        env: {
          PLOT_TERMINAL_CACHE: state.terminal,
          PLOT_PR_LISTING: reusing ? state.listing : '',
          ...(options.record ? {} : { PLOT_SCAN_RECORD: '0' }),
        },
        onErrorLine: (line) => {
          if (line.startsWith('terminal:')) learned += `${line.slice('terminal:'.length).trim()}\n`;
          if (line.startsWith('listing:')) listed += `${line.slice('listing:'.length).trim()}\n`;
        },
      });
    ended = true;
  } finally {
    // A scan that ended with its reading replaces the terminal map; any other
    // merges what it streamed. Any other adopts its listing only where the
    // listing ends with `.list-arrived`.
    const whole = ended && parsed !== null;
    state.terminal = whole ? learned : mergeTerminal(state.terminal, learned);
    if (!reusing && listed !== '' && (whole || listingEnded(listed))) {
      state.listing = listed;
      state.listingAt = Date.now();
      state.listingBranches = listedBranchCount(listed) ?? state.listingBranches;
    }
  }
  if (parsed === null) throw new Error('fleet scan ended without a terminal pulse line');
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
 * @returns whether the write landed.
 */
export const writeScan = async (
  fleetState: FleetState,
  result: ScanResult,
  at: number,
  prError: string | null,
): Promise<boolean> => {
  const written = await fleetState.write({
    at,
    pulse: result.reading,
    ages: result.ages,
    branchUrlBase: result.branchUrlBase,
    approvedAt: result.approvedAt,
    ideaPlans: result.ideaPlans,
    prError,
  });
  return written.ok;
};
