import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { transcriptDir, transcriptFile, readTranscriptFacts } from './transcript.js';
import { AgentStateSchema, type AgentState as ContractAgentState } from '../contract/schema.js';
import { scriptsShell } from '@plot-pm/domain/adapters';

/**
 * What the registry can say about an agent's liveness — one fact, computed once
 * per pulse, read by three consumers (the concurrency cap, WORKING's rows, the
 * stale-manifest problem).
 *
 * - `running` — the worktree's own `.plot-worker.pid` answers `kill -0`; the
 *   agent is on the machine now. Liveness is read from the WORKTREE by
 *   `plot-worker-state.sh`, never from the manifest pid — `bashLiveness` hands the
 *   resolver a worktree path and the shell reads `$wt/.plot-worker.pid` for
 *   itself. The manifest pid is a display fact a reader can go check, not an
 *   input to this answer.
 * - `finished` — the pid is gone and the tree shows the work reached review or
 *   nothing was left behind. The stale-manifest cure: an entry corrects itself
 *   here on the next pulse rather than persisting.
 * - `waiting` — the pid is gone and a `PLOT-BLOCKED:` marker sits in the tree; a
 *   person owes the branch an answer.
 * - `stalled` — the pid is gone and uncommitted or unpushed work is on the
 *   floor, with no PR to show for it.
 * - `failed` — a non-zero exit was recorded. The process reported its own
 *   failure, which no tree reading can improve on.
 * - `ended` — a record exists and could not be read.
 * - `none` — no record exists; nothing ever ran here, as far as the desk knows.
 * - `elsewhere` — this machine holds no worktree to look in. An agent whose
 *   worker runs on another host, which is a different answer from *no worker*.
 * - `unknown` — the registry could not decide, and says so rather than guessing.
 *   The resolver threw, its answer count did not match the batch, or the entry
 *   names no worktree at all. Absent is not a guess — the rule this contract
 *   follows everywhere.
 *
 * The first eight are exactly the states `plot-worker-state.sh` distinguishes,
 * carried onto the entry unchanged; `unknown` is the registry's own ninth for
 * the cases the shell is never asked about. It read five until 2026-09-04, when
 * `failed`, `ended`, `none` and `elsewhere` stopped being folded into `unknown`
 * — answers `bashLiveness` had received all along.
 */
export type AgentState = ContractAgentState;

/**
 * The eight states `plot-worker-state.sh` can hand back. Anything else the shell
 * might print is not a state the registry claims to understand and becomes
 * `unknown` — the same not-a-guess answer an unreadable check gets.
 *
 * DERIVED FROM THE CONTRACT ENUM rather than listed, minus the registry's own
 * `unknown`, which no shell ever prints. Listing it a second time is how the
 * collapse this removes survived a schema that already knew better.
 */
export const KNOWN_STATES: ReadonlySet<string> = new Set<string>(
  AgentStateSchema.options.filter((s) => s !== 'unknown'),
);

/**
 * Resolve liveness for a batch of worktrees, in the same order.
 *
 * A BATCH, not one call per entry: the default resolver forks bash ONCE per
 * pulse and lets the shell loop, because the registry is re-read on the scan's
 * 5 s timer and a fork per agent would put the scan's cost back — the exact
 * thing the "count in one pass" criterion guards against. Injected in tests so
 * they need not spawn a live process to assert on `running`.
 *
 * Awaited, so the fork runs OFF the event loop. A resolver that answers
 * synchronously satisfies this type unchanged — a plain array is an accepted
 * `Promise<string[]>` — so an injected test double needs no `async`.
 */
export type LivenessResolver = (worktrees: string[]) => string[] | Promise<string[]>;

/**
 * The processes one dispatch started, beside the agent itself.
 *
 * NAMED FIELDS RATHER THAN A LIST OR A PROCESS-GROUP ID, and the choice is
 * measured. A pgid would be one integer and `kill -- -PGID` would reach the whole
 * tree, but the wrapper does not get its own process group: it is started with
 * `nohup` from a non-interactive bash with no job control, so it INHERITS the
 * dispatcher's. Verified 2026-08-31 — dispatcher and wrapper both reported
 * `pgid=1298`. Recording that would name a group containing `plot-dispatch.sh`
 * itself, which is the "signal the dispatcher" hazard the wrapper-pid fix exists
 * to prevent.
 *
 * A bare list would carry the pids but not WHICH process each is, and the members
 * are not interchangeable: a monitor may be killed independently of the wrapper,
 * and a reader deciding what to do needs to know which one it is looking at.
 *
 * Each member is a decimal string, or `''` when that process was never started —
 * a hand-made worktree gets no monitors, and the field says so rather than
 * omitting the member.
 */
export interface ProcessGroup {
  /** The wrapper — owns the agent and outlives it to write `.plot-worker.exit`. */
  wrapperPid: string;
  /** The WorkerMonitor, which watches the process. */
  workerMonitorPid: string;
  /** The AgentMonitor, which watches the desk. */
  agentMonitorPid: string;
  /** The BuildMonitor, which watches the run. */
  buildMonitorPid: string;
}

/**
 * An agent as the board can name it: a process with an identity that outlives
 * the branch it was launched on.
 *
 * The distinction this type exists for: **a branch is what an agent is working
 * on, never what it is.** An agent finishes one branch and takes another, and
 * every fact the board held about it before this — `.plot-worker.pid` inside a
 * worktree, a transcript directory derived from that worktree's path — belongs
 * to the worktree rather than to the agent, so it is lost the moment the agent
 * moves on. The states that matter most are the ones no worktree can express: an
 * agent between branches, and an agent that stopped to ask.
 *
 * `branch` is therefore OPTIONAL, and empty is a real value rather than a gap.
 */
export interface AgentEntry {
  /** The session id the dispatcher minted — the identity, and the transcript's name. */
  session: string;
  /**
   * The handle a correction is resumed into, or `''` on a manifest that carries
   * none.
   *
   * **A SECOND FIELD, NOT AN ALIAS FOR {@link session}**, even though a dispatch
   * writes the same value into both. `session` is the transcript join key and
   * stays fixed across a branch hop by design — `plot-worker-loop.sh` rewrites
   * `branch` and `worktree` on a hop and leaves `session` alone. The resume
   * handle is a different identity with a different lifetime, and whether it
   * should follow a hop cannot even be ASKED while one field carries both
   * meanings. Nothing may assume the two agree.
   *
   * A handle alone never means resume is possible: the runtime writes a
   * transcript for it only if the project's `.plot/worker-prompt.sh` passed
   * `--session-id`, which Plot does not own. `resumeAvailability` is what
   * answers, from the transcript rather than from this field.
   */
  resumeId: string;
  /**
   * How many times this agent was retried AUTOMATICALLY — 0 on a first
   * dispatch.
   *
   * Distinct from {@link relaunches}, which counts operator-initiated restarts
   * and is a human's record. This is the automatic budget's own counter, so a
   * person's three manual restarts cannot exhaust it and an automatic retry
   * cannot be mistaken for a person losing patience.
   *
   * WRITTEN BY THE SUPERVISOR AND BY THE LOOP. It said *supervisor* alone until
   * 2026-09-05, when `plot-worker-loop.sh` gained a retry of its own: a prompt
   * whose command exits non-zero without running keeps its slice and is tried
   * again, and without a budget it repeats for the full `Worker bound`. The
   * loop is not a supervisor, but the line this field draws is AUTOMATIC versus
   * A PERSON'S, and a loop retry is automatic by every property that
   * distinction was made for. Past the budget the loop ends the worker and
   * leaves a `PLOT-BLOCKED` marker, which is where a person takes over.
   */
  attempts: number;
  /** The branch it holds, or `''` while it holds none. */
  branch: string;
  worktree: string;
  /** The full `Worker command` as launched, quotes and newlines intact. */
  command: string;
  /** ISO-8601, written by the dispatcher at launch. */
  startedAt: string;
  /**
   * The AGENT's pid, written into the manifest by the wrapper the instant it
   * learns its own child — the same value that lands in `.plot-worker.pid`.
   *
   * `''` on an older manifest that carried none, and on a pid that cannot be
   * one: `0` (`kill -0 0` signals the whole process group and succeeds) or
   * non-numeric junk. It is a launch fact, so the registry can check liveness in
   * one pass without a per-entry worktree lookup — but a pid alone never means
   * `running`: {@link state} is what says the process still answers.
   */
  pid: string;
  /**
   * Every process the registry started for this agent, or `undefined` on a
   * manifest written before the field existed.
   *
   * **`undefined` is `unknown`, and an empty member is `none`** — the same
   * distinction {@link pid} draws, and the reason this is an optional object
   * rather than three always-present strings. An old manifest cannot say what it
   * started, and reporting it as *nothing was started* would be a claim the file
   * never made. A dispatch that attached no monitor DID say so, with `''`.
   *
   * The registry spawned these, so the registry records them — written at spawn
   * by the wrapper, never discovered later by scanning `ps` for a pattern.
   *
   * Like {@link pid}, this is a DISPLAY FACT a reader can go check, not an input
   * to liveness: a manifest can go stale, and only the process table answers
   * whether one of these still runs.
   */
  group?: ProcessGroup;
  /**
   * The pid this run displaced when it relaunched in place, or `''` on a first
   * dispatch. Written by the launch stamp — see `manifest-stamp.ts`.
   */
  previousPid: string;
  /** How many times this worktree's worker has been relaunched — 0 on a first dispatch. */
  relaunches: number;
  /**
   * Whether this agent is still running — the fact the registry exists to
   * answer, refreshed on every pulse from {@link AgentState}. `unknown` where it
   * could not be decided; never a guess.
   */
  state: AgentState;
  /** From the transcript. Absent when it could not be read — never guessed. */
  model?: string;
  contextTokens?: number;
  /** Every input token the last turn carried, summed by the domain. */
  contextSpend?: number;
  lastActivity?: string;
}

/** Where the dispatcher writes manifests, relative to the repo root. */
export const AGENT_MANIFEST_DIR = '.plot/agents';

/**
 * The `## Plot Config` key that names the manifest directory.
 *
 * Its default is {@link AGENT_MANIFEST_DIR} — today's path — so a single-checkout
 * project that never sets it sees no change. A project whose board is served from
 * a different worktree than the dispatcher writes to points this at a shared
 * location, and the board finds the registry wherever it was started from.
 */
export const AGENT_MANIFEST_DIR_KEY = 'Agent registry';

/**
 * Resolve the manifest directory to an absolute path.
 *
 * Precedence, each an escape the layer above can take without the one below:
 * 1. An explicit `manifestDir` option — the test seam, and a caller that has
 *    already resolved the directory itself.
 * 2. `plot-config.sh get "{@link AGENT_MANIFEST_DIR_KEY}" "{@link AGENT_MANIFEST_DIR}"`,
 *    but ONLY when `scriptsDir` is known — the same graceful degradation every
 *    other injected resolver follows: no scripts, no shell-out.
 * 3. The default {@link AGENT_MANIFEST_DIR}.
 *
 * A relative result (the common case — `.plot/agents`, or a repo-relative
 * override) is joined against `repoRoot`; an absolute result is taken as-is, so a
 * project may name a registry outside its own tree. The shell-out is wrapped so a
 * missing or unreadable `plot-config.sh` falls back to the default rather than
 * failing the read — the registry must never crash a listing for want of config.
 *
 * **Exported** so the Drop endpoint resolves the directory the SAME way the
 * reader does. Two implementations of *where is the registry* is how they drift;
 * `drop.ts` imports this rather than re-joining {@link AGENT_MANIFEST_DIR}. The
 * parameter is narrowed to the two fields resolution actually reads, so a caller
 * that is not the reader need not carry the reader's whole options shape.
 *
 * ## Still synchronous, and the split is deliberate
 *
 * This is the ONE spawn in this file that serves both a read and a write. The
 * reader calls {@link resolveManifestDirAsync}; the two WRITE callers —
 * `drop.ts`'s `POST /api/registry/drop` and `manifest-stamp.ts` — keep this
 * one, because a synchronous spawn on a write route blocks the loop for the
 * operator who clicked, while one on the registry read blocked it for every
 * viewer on the fleet's 5 s pulse. Same defect, different blast radius, and
 * only the second one is this plan's subject.
 *
 * The two share {@link joinManifestDir}, so *where is the registry* still has
 * one answer and the read and write halves cannot drift apart.
 */
export function resolveManifestDir(
  repoRoot: string,
  opts: { manifestDir?: string; scriptsDir?: string },
): string {
  return joinManifestDir(
    repoRoot,
    opts.manifestDir ?? readManifestDirConfig(repoRoot, opts.scriptsDir),
  );
}

/**
 * The same resolution, awaited — what the registry READ calls.
 *
 * `plot-config.sh` is spawned through `execFile` rather than `execFileSync`, so
 * the event loop keeps serving while it runs. That is the whole difference and
 * it is the whole point.
 *
 * @param repoRoot - the repository the registry belongs to.
 * @param opts - an already-resolved directory, or the scripts to ask.
 * @returns the absolute manifest directory.
 */
export async function resolveManifestDirAsync(
  repoRoot: string,
  opts: { manifestDir?: string; scriptsDir?: string },
): Promise<string> {
  return joinManifestDir(
    repoRoot,
    opts.manifestDir ?? (await readManifestDirConfigAsync(repoRoot, opts.scriptsDir)),
  );
}

/**
 * Anchor a configured directory against the repository.
 *
 * A relative result (the common case — `.plot/agents`, or a repo-relative
 * override) is joined against `repoRoot`; an absolute result is taken as-is, so
 * a project may name a registry outside its own tree.
 *
 * @param repoRoot - the repository to join relative paths against.
 * @param configured - what the config or the caller named.
 * @returns the absolute directory.
 */
function joinManifestDir(repoRoot: string, configured: string): string {
  return path.isAbsolute(configured) ? configured : path.join(repoRoot, configured);
}

/**
 * Read the manifest-directory config value via `plot-config.sh`, or the default.
 *
 * Returns {@link AGENT_MANIFEST_DIR} when no `scriptsDir` is known (a bare call
 * never shells out) or when the shell-out fails for any reason.
 */
/** The ONE answer to *is a worker running in this worktree?*, sourced not run. */
const WORKER_STATE_SCRIPT = 'plot-worker-state.sh';

function readManifestDirConfig(repoRoot: string, scriptsDir?: string): string {
  if (!scriptsDir) return AGENT_MANIFEST_DIR;
  const answer = scriptsShell({ repoRoot, scriptDir: scriptsDir })
    .configSync(AGENT_MANIFEST_DIR_KEY, AGENT_MANIFEST_DIR);
  return (answer.ok ? answer.value.trim() : '') || AGENT_MANIFEST_DIR;
}

/**
 * The same lookup, off the event loop.
 *
 * An unreadable config answers {@link AGENT_MANIFEST_DIR}, matching the
 * synchronous twin: `plot-config.sh` returns the fallback for an absent key, so
 * *absent* is an answer here rather than a failure to report.
 */
async function readManifestDirConfigAsync(
  repoRoot: string,
  scriptsDir?: string,
): Promise<string> {
  if (!scriptsDir) return AGENT_MANIFEST_DIR;
  const answer = await scriptsShell({ repoRoot, scriptDir: scriptsDir })
    .config(AGENT_MANIFEST_DIR_KEY, AGENT_MANIFEST_DIR);
  return (answer.ok ? answer.value.trim() : '') || AGENT_MANIFEST_DIR;
}

/**
 * Runs a command off the event loop and answers its stdout, or null.
 *
 * The process helper this file's read path uses, for the three spawns that
 * are not questions any existing port answers in the shape the registry needs:
 * `plot-config.sh`, `plot-worker-state.sh` in BATCH, and the batched
 * cleanliness program. Each caller says below what an absent answer means for
 * it — `null` is never silently read as a value.
 *
 * @param command - the executable to run.
 * @param args - its arguments.
 * @param options - where to run it.
 * @returns stdout, or null for any failure.
 */
function run(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd: options.cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

/**
 * One manifest → one entry, or null.
 *
 * Returns null for anything that is not a manifest this reader recognises, and
 * the bar is deliberately low: a `session` string is the only requirement,
 * because it is the key everything else joins on. A manifest missing it names no
 * agent and cannot be repaired by defaulting.
 *
 * Every other field defaults to its empty value rather than rejecting the entry.
 * A manifest written by an older dispatcher must still list its agent — the
 * whole point of the registry is that an agent nobody can see is an agent that
 * gets restarted into the same work.
 */
export function parseManifest(json: string): AgentEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const session = typeof o.session === 'string' ? o.session.trim() : '';
  if (session === '') return null;
  const group = readGroup(o);
  return {
    session,
    // NOT DEFAULTED TO `session`, and that is the whole reason it is a second
    // field. A manifest written before this existed asserts no resume handle,
    // and filling one in from the join key would invent a claim the file never
    // made — precisely the collapse the plan forbids. `''` is *no handle*, and
    // `resumeAvailability` refuses on it by name.
    resumeId: typeof o.resumeId === 'string' ? o.resumeId : '',
    // A COUNT, AND NEVER A GUESS. An older manifest carried none, which means
    // no supervisor has retried this agent — the same reading `relaunches`
    // takes of its own absence. Negative and non-integer values are junk and
    // read as 0 rather than being carried into a bound.
    attempts:
      typeof o.attempts === 'number' && Number.isInteger(o.attempts) && o.attempts >= 0
        ? o.attempts
        : 0,
    branch: typeof o.branch === 'string' ? o.branch : '',
    worktree: typeof o.worktree === 'string' ? o.worktree : '',
    command: typeof o.command === 'string' ? o.command : '',
    startedAt: typeof o.startedAt === 'string' ? o.startedAt : '',
    pid: readPid(o.pid),
    // ABSENT IS NOT NONE. A manifest carrying none of the group fields predates
    // them and its group is UNKNOWN — `undefined`, so a reader can tell it from a
    // dispatch that started no monitors and recorded `''`. See `readGroup`.
    ...(group ? { group } : {}),
    // A relaunch stamp records both; a first dispatch records neither, so an
    // older or unrelaunched manifest defaults to "displaced nothing, never
    // restarted". `previousPid` is read leniently (any string), because unlike
    // `pid` it is a display fact only — nothing checks liveness against it.
    previousPid: typeof o.previousPid === 'string' ? o.previousPid : '',
    relaunches: typeof o.relaunches === 'number' && o.relaunches >= 0 ? o.relaunches : 0,
    // A launch fact carries no liveness. State is decided per pulse in
    // `readAgentRegistry`; a manifest never asserts it, so it starts `unknown`.
    state: 'unknown',
  };
}

/**
 * The process group off a manifest, or `undefined` when it carries none.
 *
 * **The absent/none distinction is the whole contract.** A manifest written
 * before this field existed says nothing about what it started, and must report
 * `unknown` rather than `empty` — so `undefined` is returned unless AT LEAST ONE
 * of the three keys is present. Once any is, the group is known and each missing
 * or unusable member reads `''`, meaning *that process was never started*.
 *
 * Members go through {@link readPid}, so `0` and junk fall back to `''` for the
 * reasons it gives — a group member that cannot be a pid is not one, and a reader
 * checking it against the process table must not be handed a value that answers
 * about the wrong thing.
 */
function readGroup(o: Record<string, unknown>): ProcessGroup | undefined {
  const keys = ['wrapperPid', 'workerMonitorPid', 'agentMonitorPid', 'buildMonitorPid'] as const;
  if (!keys.some((k) => k in o)) return undefined;
  return {
    wrapperPid: readPid(o.wrapperPid),
    workerMonitorPid: readPid(o.workerMonitorPid),
    agentMonitorPid: readPid(o.agentMonitorPid),
    buildMonitorPid: readPid(o.buildMonitorPid),
  };
}

/**
 * The pid off a manifest, as a validated string — or `''` when there is none to
 * trust.
 *
 * Written as a JSON string by the dispatcher, but an older manifest may carry a
 * number or nothing. `0` and non-numeric junk are refused for the reasons
 * `plot-worker-state.sh` refuses them: `kill -0 0` signals the whole process
 * group and reads as running forever, and junk is not a pid at all. The one
 * rejection point, so a bad value fails as absent rather than as a `running`
 * later.
 */
function readPid(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  if (!/^\d+$/.test(s)) return '';
  if (Number(s) <= 0) return '';
  return s;
}

/**
 * Every agent the dispatcher has launched, newest first, each joined to its
 * transcript **by exact session id**.
 *
 * The exact join is the point. `transcriptFile` also accepts no id and returns
 * the newest non-`agent-` file in the directory, which is a guess — measured
 * 2026-08-20, one worktree held eight transcripts, so "the newest" answers about
 * whichever run touched the disk last rather than about this agent. The manifest
 * exists to remove that guess, and passing the id is what removes it.
 *
 * **A missing or unreadable transcript costs fields, not entries.** `model`,
 * `contextTokens` and `lastActivity` are absent, the agent is still listed. The
 * transcript format is the runtime's private business and may change; an entry
 * that vanished when it did would take the agent with it.
 *
 * Absence at every level yields an empty list rather than a throw: no
 * `.plot/agents` directory (no dispatch has run), an unreadable directory, an
 * unparseable file. The board renders this on the scan's timer and a crash here
 * would cost the whole pulse.
 *
 * **Every entry carries a pulse-refreshed {@link AgentEntry.state}.** After the
 * manifests are read, the entries that have both a pid and a worktree are asked
 * — in ONE batch, once — whether their process is still alive; the answer lands
 * on the entry. An entry the check cannot cover (no pid, no worktree) stays
 * `unknown`, and a check that throws leaves every entry `unknown` rather than
 * failing the read. Liveness never blocks the listing: an agent invisible during
 * an outage is one that gets restarted into work it already holds.
 */
export interface ReadRegistryOptions {
  /**
   * The runtime's home, where transcripts live. Injectable so tests need not
   * write into a developer's real `~/.claude`.
   */
  home?: string;
  /**
   * Where Plot's helper scripts live — needed by the default liveness resolver
   * to find `plot-worker-state.sh`. When absent, liveness is never checked and
   * every entry stays `unknown`: the registry lists agents even where it cannot
   * find the script to classify them.
   */
  scriptsDir?: string;
  /**
   * Resolve liveness for a batch of worktrees. Injected in tests; in production
   * the default {@link bashLiveness} reuses `plot-worker-state.sh`.
   */
  liveness?: LivenessResolver;
  /**
   * Enumerate the repo's worktrees, for Fix C — synthesizing an entry for a
   * worktree no manifest names. Injected in tests; in production the default
   * {@link gitWorktrees} runs `git worktree list --porcelain`. When it throws or
   * is absent, nothing is synthesized and only manifest-backed entries list — the
   * registry never fails a read for want of the worktree list.
   */
  worktrees?: WorktreeLister;
  /**
   * Resolve whether worktrees are "clean" — no uncommitted changes AND no
   * unpushed commits. Injected in tests; in production the default is a no-op
   * (no entries dropped).
   *
   * An entry whose session has ended AND whose worktree is clean is DROPPED
   * from the listing — a settled worker with nothing outstanding to collect.
   * Either condition outstanding (live session OR dirty/unpushed) and the
   * entry stays visible.
   *
   * This is OPT-IN: the board passes {@link bashCleanliness} to enable it;
   * callers that want all entries simply omit this option.
   */
  cleanliness?: CleanlinessResolver;
  /**
   * The manifest directory, already resolved. Injected in tests, and usable by a
   * caller that has resolved the directory itself. When absent, the directory is
   * read from `## Plot Config` via `plot-config.sh` (see {@link resolveManifestDir}),
   * defaulting to {@link AGENT_MANIFEST_DIR}.
   *
   * A relative path is joined against `repoRoot`; an absolute path is taken as-is.
   */
  manifestDir?: string;
}

/**
 * One worktree as the registry needs it: its path, the branch it holds, and
 * whether it is the repo's PRIMARY checkout.
 *
 * `isMain` and an empty `branch` are the two exclusions Fix C draws: the main
 * repo is not an agent, and a branchless (detached/unreadable) worktree has
 * nothing an agent row could be about.
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

/**
 * Enumerate the repo's worktrees. Injected in tests; default {@link gitWorktrees}.
 *
 * Awaited like {@link LivenessResolver}, and a synchronous lister still
 * satisfies it.
 */
export type WorktreeLister = () => WorktreeInfo[] | Promise<WorktreeInfo[]>;

/**
 * Resolve whether each worktree in a batch is "clean", in the same order.
 *
 * **Clean** means two things are BOTH true:
 * 1. No uncommitted changes (`git status --porcelain` is empty)
 * 2. No unpushed commits (`git rev-list --count @{upstream}..HEAD` is 0 or no upstream)
 *
 * Injected in tests; in production {@link bashCleanliness} does the work in
 * ONE bash process, like {@link bashLiveness}.
 *
 * Returns `true` for clean, `false` for dirty/unpushed. A worktree that cannot
 * be checked (no git, no upstream) returns `false` — the entry stays visible
 * rather than being silently dropped.
 *
 * Awaited like {@link LivenessResolver}, and a synchronous resolver still
 * satisfies it.
 */
export type CleanlinessResolver = (worktrees: string[]) => boolean[] | Promise<boolean[]>;

/**
 * Metadata about the registry read — the facts that make a synthesized fleet
 * legible rather than silent.
 */
export interface RegistryInfo {
  /** The resolved absolute path where manifests were read. */
  directory: string;
  /** How many manifests were successfully parsed. */
  manifestCount: number;
  /** How many entries were synthesized from worktrees with no manifest. */
  synthesizedCount: number;
}

/**
 * The registry's full answer: entries AND metadata. See
 * {@link readAgentRegistryWithInfo} for the caller that needs both.
 */
export interface RegistryResult {
  entries: AgentEntry[];
  info: RegistryInfo;
}

export async function readAgentRegistry(
  repoRoot: string,
  home?: string,
  opts: ReadRegistryOptions = {},
): Promise<AgentEntry[]> {
  return (await readAgentRegistryWithInfo(repoRoot, home, opts)).entries;
}

/**
 * Read the registry and return both entries AND metadata.
 *
 * The metadata makes a synthesized fleet legible: `0 manifests, 12 synthesized`
 * says the fleet is not empty, just identity-less. The board renders this in
 * the WORKING section so an operator knows immediately whether the drop menu
 * is missing because nothing is broken or because the board is reading an
 * empty directory.
 */
export async function readAgentRegistryWithInfo(
  repoRoot: string,
  home?: string,
  opts: ReadRegistryOptions = {},
): Promise<RegistryResult> {
  const dir = await resolveManifestDirAsync(repoRoot, opts);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // No manifest directory — no dispatch has ever run through it. This is not a
    // throw: a worktree with no manifest may still be synthesized below, so the
    // read continues rather than returning here.
    names = [];
  }
  const out: AgentEntry[] = [];
  let manifestCount = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let entry: AgentEntry | null;
    try {
      entry = parseManifest(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    if (!entry) continue;
    manifestCount++;
    // The transcript lives beside the WORKTREE, not beside the manifest: the
    // runtime keys its project directory on the cwd it ran in. An entry whose
    // worktree is unknown simply has no transcript to join.
    if (entry.worktree) {
      try {
        const tdir = transcriptDir(entry.worktree, home);
        const file = transcriptFile(tdir, entry.session);
        if (file) Object.assign(entry, readTranscriptFacts(file));
      } catch {
        // Fields absent. The entry stays — see above.
      }
    }
    out.push(entry);
  }
  // Fix C: a worktree no manifest names is still an agent the registry cannot
  // rule out. Synthesize one entry per such worktree — but never for a path a
  // manifest already claims (a manifest wins), never for the main repo, and never
  // for a branchless worktree. Both `path` and its realpath are held in the seen
  // set because a manifest records the resolved path and git may report either.
  const claimed = new Set<string>();
  for (const e of out) {
    if (!e.worktree) continue;
    claimed.add(e.worktree);
    try {
      claimed.add(fs.realpathSync(e.worktree));
    } catch {
      /* the worktree may be gone; the raw path is enough to dedupe */
    }
  }
  let synthesizedCount = 0;
  {
    const lister = opts.worktrees ?? (() => gitWorktrees(repoRoot));
    let worktrees: WorktreeInfo[] = [];
    try {
      worktrees = await lister();
    } catch {
      worktrees = []; // The listing failed; synthesize nothing rather than throw.
    }
    for (const wt of worktrees) {
      if (wt.isMain) continue; // The main repo is not an agent.
      if (wt.branch === '') continue; // A branchless worktree is not an agent row.
      if (claimed.has(wt.path)) continue; // A manifest already names this path.
      out.push(synthesizeEntry(wt));
      synthesizedCount++;
    }
  }
  await refreshStates(out, opts.liveness ?? defaultLiveness(opts.scriptsDir));
  // Drop settled workers: session ended AND worktree clean. A worker with either
  // condition outstanding — live session OR dirty/unpushed — stays visible.
  const filtered = await dropSettledWorkers(
    out,
    opts.cleanliness ?? defaultCleanliness(),
  );
  // Newest first, by launch time. A manifest with no `startedAt` sorts last
  // rather than first: an unknown time must not claim to be the most recent. A
  // synthesized entry has no `startedAt` and so sorts among those last, which is
  // right — the registry knows least about it.
  const entries = filtered.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  return {
    entries,
    info: { directory: dir, manifestCount, synthesizedCount },
  };
}

/**
 * An entry for a worktree the registry can see but has no manifest for.
 *
 * It invents NOTHING it does not have. `session` is `''` — the id is minted at
 * launch and this worktree has none, so the transcript join (which keys on the
 * session) is skipped and the transcript fields stay absent, exactly the
 * *a missing transcript costs fields, not entries* rule applied to an entry that
 * never had one. `command` and `startedAt` are `''`: they are launch facts, and a
 * start time guessed from the worktree's mtime would read as a launch record and
 * be false. `pid` is `''`; the state is refreshed from the worktree by the pulse
 * like any other entry.
 *
 * `resumeId` is `''` for the same reason `session` is, and it costs the entry
 * its resume path: a worktree nobody registered was never handed a session id,
 * so no transcript carries its conversation and a correction has nowhere to go.
 * That is the honest reading rather than a gap — `resumeAvailability` refuses on
 * it and the caller starts a fresh worker.
 *
 * A manifest becomes the record of a DISPATCH, not the definition of an agent's
 * existence — the worktree is what exists.
 */
function synthesizeEntry(wt: WorktreeInfo): AgentEntry {
  return {
    session: '',
    resumeId: '',
    attempts: 0,
    branch: wt.branch,
    worktree: wt.path,
    command: '',
    startedAt: '',
    pid: '',
    previousPid: '',
    relaunches: 0,
    state: 'unknown',
  };
}

/**
 * Refresh each entry's {@link AgentEntry.state} from liveness, in place.
 *
 * An entry is checkable when it names a WORKTREE — that is the only input the
 * resolver takes. `plot-worker-state.sh` is handed the worktree path and reads
 * `$wt/.plot-worker.pid` for itself; the manifest pid is never consulted, so
 * gating on it asked for a ticket the questioner does not read and skipped nine
 * entries here whose worktree existed and would have answered correctly. An entry
 * with no worktree stays `unknown` and is never handed to the resolver — there is
 * nothing to look in, and asking would let a guess become a state.
 *
 * ONE batch call for all checkable entries, so the default resolver forks bash
 * once per pulse rather than once per agent. A resolver that throws, or returns
 * the wrong number of answers, leaves every entry `unknown`: the registry must
 * list its agents even when it cannot classify them.
 */
async function refreshStates(entries: AgentEntry[], liveness: LivenessResolver): Promise<void> {
  const checkable = entries.filter((e) => e.worktree !== '');
  if (checkable.length === 0) return;
  let answers: string[];
  try {
    answers = await liveness(checkable.map((e) => e.worktree));
  } catch {
    return; // Every entry stays `unknown`.
  }
  if (answers.length !== checkable.length) return;
  checkable.forEach((entry, i) => {
    const answer = answers[i] as AgentState;
    entry.state = KNOWN_STATES.has(answer) ? answer : 'unknown';
  });
}

/**
 * The default liveness resolver, or a no-op when no scripts directory is known.
 *
 * Kept separate from {@link bashLiveness} so the "no scriptsDir → every entry
 * `unknown`" path is a plain empty-answer resolver rather than a special case
 * threaded through the batch call.
 */
function defaultLiveness(scriptsDir?: string): LivenessResolver {
  if (!scriptsDir) return () => [];
  return (worktrees: string[]) => bashLiveness(scriptsDir, worktrees);
}

/**
 * Reuse `plot-worker-state.sh` to classify a batch of worktrees, in order.
 *
 * ONE bash process for the whole batch. It sources the shared helper — the same
 * function `plot-fleet-scan.sh` and `plot-dispatch.sh` source, so liveness has a
 * single definition — and prints one state per worktree, NUL-separated in the
 * same order they arrived. The registry reimplements none of it.
 *
 * The PR fact is deliberately empty. `plot_worker_state` accepts an empty
 * second argument and its own contract says so: *a caller that cannot know says
 * nothing, and a branch with work on the floor then reads `stalled`*. The
 * registry cannot afford the host call that would fill it — the registry must
 * not be behind anything that can fail — so it reads liveness from local signals
 * only and lets `finished`-vs-`stalled` be the honest local answer.
 *
 * A failure — bash absent, the script unreadable, a worktree path that upsets
 * it — answers an empty array, and `refreshStates` reads the length mismatch
 * into `unknown` for the batch. The listing is never at risk.
 *
 * ## Why this stays a batch rather than becoming one `Processes.workerState`
 * ## call per entry
 *
 * The plan's second Open Question asks whether per-item port calls trade one
 * blocking spawn for many awaited ones. **Measured here on 2026-09-01, 20
 * worktrees:** the batch answers in 210 ms and 20 separate `bash -c` calls in
 * 290 ms — 1.4×, not 20×, because the cost is the work INSIDE each call rather
 * than the fork around it. So per-item would be affordable.
 *
 * It stays a batch anyway, for a reason that is not performance: the batch is
 * what makes ONE fork's failure ONE answer. `refreshStates` treats a wrong
 * answer count as *every entry unknown*, and that contract only reads cleanly
 * while there is a single call to succeed or fail. Twenty independent calls
 * would each have their own outcome, and the honest reading of a partial
 * result — nine states and eleven failures — is a question this registry has
 * never had to answer.
 */
function bashLiveness(scriptsDir: string, worktrees: string[]): string[] {
  // Source the helper, then loop the worktrees passed as positional arguments,
  // emitting only the state field (the first tab-separated column) NUL-delimited.
  const program =
    `. "$1"; shift; for wt in "$@"; do ` +
    `printf '%s\\0' "$(plot_worker_state "$wt" '' | cut -f1)"; done`;
  // THIS PROCESS'S DIRECTORY, as before: the worktree paths are absolute, so
  // the helper never resolves anything against the working directory and no
  // caller of this function has a repository root to give it.
  const answer = scriptsShell({ repoRoot: process.cwd(), scriptDir: scriptsDir })
    .sourced(WORKER_STATE_SCRIPT, program, worktrees);
  // A refusal THROWS, which `refreshStates` catches into `unknown` for the
  // batch. Its length-mismatch arm reaches the same place, so the two refusal
  // shapes this function has carried are one answer to its caller.
  if (!answer.ok) throw new Error('plot-worker-state could not be asked');
  // Trailing NUL leaves an empty final element; drop it. One answer per worktree.
  const parts = answer.value.split('\0');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * The default worktree lister — `git worktree list --porcelain` for Fix C.
 *
 * The porcelain form emits one block per worktree: a `worktree <path>` line,
 * then `HEAD <sha>`, then EITHER `branch refs/heads/<name>` OR `detached`. The
 * FIRST block is always the primary checkout — the main repo — which is the one
 * exclusion git itself hands us; a block with no `branch` line is branchless and
 * carries `branch: ''`, the other exclusion.
 *
 * Answers `[]` on any git failure (no repo, git absent), which
 * `readAgentRegistry` renders as "synthesize nothing": the worktree list is an
 * enrichment, never a dependency the listing can fail on. It used to throw and
 * be caught into the same outcome; awaited, the failure is a value rather than
 * a control-flow jump, and the outcome is unchanged.
 */
export async function gitWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  const out = await run('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  if (out === null) return [];
  const infos: WorktreeInfo[] = [];
  let cur: { path: string; branch: string } | null = null;
  let first = true;
  const flush = () => {
    if (cur) {
      infos.push({ path: cur.path, branch: cur.branch, isMain: first });
      first = false;
      cur = null;
    }
  };
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      cur = { path: line.slice('worktree '.length), branch: '' };
    } else if (line.startsWith('branch ') && cur) {
      // `branch refs/heads/feature/x` → `feature/x`. A ref outside refs/heads is
      // left whole rather than mangled — an agent row still names something real.
      const ref = line.slice('branch '.length);
      cur.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    }
    // `detached` and every other porcelain key leave `branch` as '' — the
    // branchless exclusion, decided by the absence of a `branch` line.
  }
  flush();
  return infos;
}

/**
 * Drop entries whose session has ended AND whose worktree is clean.
 *
 * An entry is dropped only when BOTH conditions hold:
 * 1. The session has ended — the state is anything except `running`.
 * 2. The worktree is clean — no uncommitted changes AND no unpushed commits.
 *
 * Either condition outstanding (live session OR dirty/unpushed) and the entry
 * stays visible. A worker with a dirty worktree and an ended session is still
 * reported with what it is holding; a worker with a clean worktree and a live
 * session is still working. Only a worker with nothing outstanding disappears.
 *
 * **An entry with no worktree is NEVER dropped.** There is nothing to check,
 * and "clean" requires evidence of cleanliness — which an absent worktree
 * cannot provide. The same "absent is not false" rule as everywhere else.
 */
async function dropSettledWorkers(
  entries: AgentEntry[],
  cleanliness: CleanlinessResolver,
): Promise<AgentEntry[]> {
  // First pass: find entries that MIGHT be dropped — session ended AND has a
  // worktree to check. Running entries stay; entries with no worktree stay.
  const candidates: AgentEntry[] = [];
  const candidateIndices: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.state === 'running') continue; // Live session — keep.
    if (e.worktree === '') continue; // No worktree to check — keep.
    candidates.push(e);
    candidateIndices.push(i);
  }
  if (candidates.length === 0) return entries;

  // Second pass: check cleanliness of the candidates in one batch call.
  let isClean: boolean[];
  try {
    isClean = await cleanliness(candidates.map((e) => e.worktree));
  } catch {
    // If cleanliness check fails, keep all entries — fail open rather than
    // dropping entries we cannot verify.
    return entries;
  }
  if (isClean.length !== candidates.length) return entries;

  // Third pass: drop entries that are both ended AND clean.
  const dropped = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    if (isClean[i]) dropped.add(candidateIndices[i]);
  }
  return entries.filter((_, i) => !dropped.has(i));
}

/**
 * The default cleanliness resolver — a no-op that drops nobody.
 *
 * Cleanliness checking is OPT-IN, not automatic. The registry lists agents even
 * where it cannot verify their worktrees, and dropping settled workers is an
 * optimization for the board's display, not a core listing requirement.
 *
 * To enable dropping, pass an explicit `cleanliness` resolver in the options.
 * The board does this in fleet.ts with {@link bashCleanliness}.
 */
function defaultCleanliness(): CleanlinessResolver {
  return () => [];
}

/**
 * Check whether each worktree is "clean" — no uncommitted AND no unpushed.
 *
 * ONE bash process for the whole batch. Each worktree is checked for:
 * 1. Uncommitted changes: `git -C <wt> status --porcelain` is empty
 * 2. Unpushed commits: `git -C <wt> rev-list --count @{upstream}..HEAD` is 0
 *    OR no upstream exists (which means no commits to push).
 *
 * Returns `true` for clean, `false` for dirty/unpushed. A worktree that cannot
 * be checked (not a git repo, permission denied) returns `false` — the entry
 * stays visible rather than being silently dropped.
 *
 * The exclusions from `plot-worker-state.sh` are applied here:
 * - Editor leftovers (`.tmp1`, `.swp`, etc.) are ignored.
 * - Plot's own records (`.plot-worker.*`) are ignored.
 * - Tool scratch directories (`.playwright-mcp/`, `.plot/agents/`, `.omc/state/`) are ignored.
 *
 * **Exported for use by fleet.ts**, where the board enables dropping of settled
 * workers. The registry itself defaults to keeping all entries.
 *
 * ## Why not `Trees.isClean`
 *
 * The port exists and this looks like its question, but the two answer
 * DIFFERENTLY and the difference drops work off the board. `trees-git.ts`
 * reads `git status --porcelain` alone: no exclusions and no unpushed-commit
 * check. Against this definition that is wrong twice —
 *
 * - **A tree holding only `.plot-worker.pid` reads dirty**, so a settled worker
 *   never drops and the panel keeps clutter forever. Measured 2026-09-01: 1 of
 *   20 worktrees on this estate differs on exactly this.
 * - **A tree with unpushed commits reads clean**, so an agent whose work exists
 *   only in its local reflog drops OUT of the listing — the one failure the
 *   whole drop rule is written around.
 *
 * So this batch stays, awaited rather than blocking. Widening `Trees.isClean`
 * to carry the exclusions and the upstream check is a change to a port two
 * other slices read, which is a write this read-path plan does not own.
 */
export async function bashCleanliness(worktrees: string[]): Promise<boolean[]> {
  if (worktrees.length === 0) return [];
  // The script checks each worktree and prints "clean" or "dirty" NUL-separated.
  // It applies the same exclusion patterns as plot-worker-state.sh to be consistent.
  const program = `
    PLOT_WORKER_RECORD='\\.plot-worker\\.'
    PLOT_EDITOR_LEFTOVER='\\.(tmp[0-9]*|swp|orig|rej|bak)$'
    PLOT_TOOL_SCRATCH='(^|/)\\.(playwright-mcp|plot/agents|plot/state|omc/state)(/|$)'
    for wt in "$@"; do
      if [ ! -d "$wt" ]; then
        printf 'dirty\\0'
        continue
      fi
      # Check uncommitted changes (with exclusions)
      status=$(git -C "$wt" status --porcelain 2>/dev/null || echo "")
      filtered=$(printf '%s' "$status" \\
        | cut -c4- \\
        | grep -vE "(^|/)$PLOT_WORKER_RECORD" \\
        | grep -vE "$PLOT_EDITOR_LEFTOVER" \\
        | grep -vE "$PLOT_TOOL_SCRATCH" || true)
      if [ -n "$filtered" ]; then
        printf 'dirty\\0'
        continue
      fi
      # Check unpushed commits
      ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo "0")
      case "$ahead" in
        ''|0|*[!0-9]*) printf 'clean\\0' ;;
        *) printf 'dirty\\0' ;;
      esac
    done
  `;
  const out = await run('bash', ['-c', program, 'bash', ...worktrees]);
  // An unreadable batch drops NOBODY. `dropSettledWorkers` takes a length
  // mismatch as "keep every entry", which is the fail-open this resolver has
  // always had — an entry we cannot verify is an entry that stays visible.
  if (out === null) return [];
  // Trailing NUL leaves an empty final element; drop it.
  const parts = out.split('\0');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.map((p) => p === 'clean');
}
