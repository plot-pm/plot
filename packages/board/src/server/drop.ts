import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { parseManifest, resolveManifestDir, type AgentEntry, type LivenessResolver } from './registry.js';
import { LIVE_STATES } from '../contract/schema.js';
import { localCapability } from './controllers/caller.js';

/**
 * `POST /api/registry/drop` — remove a registry entry that is no longer running.
 *
 * THE BOARD'S MANUAL RECONCILIATION. The registry survives a settled worker
 * only while something outstanding remains — uncommitted changes, unpushed
 * commits, a stale worktree. The automatic cleanliness resolver drops settled
 * entries on the next pulse, but only for entries whose worktree is verifiably
 * clean. This endpoint is the escape hatch for entries the automatic resolver
 * cannot clear: worktrees that have been removed manually, manifests that
 * outlived their process, or any other condition that leaves an entry orphaned.
 *
 * IT REFUSES TO DROP A LIVE WORKER. An entry in a live state (`running`,
 * `waiting`) cannot be dropped — the worker is still there, and removing its
 * manifest would hide it from the board while leaving it running. The registry
 * is not a killswitch; it is a record.
 *
 * IT REFUSES AN UNVERIFIABLE ONE ONLY WHILE ITS WORKTREE EXISTS. An `unknown`
 * state means *could not check*, and for a worktree that is still there that
 * has to be read as *might be running*. For a worktree that has been DELETED
 * it is the opposite — nothing runs in a directory that does not exist — and
 * the entry drops. See {@link worktreeIsGone}.
 *
 * WHY A SESSION, NOT A BRANCH. The manifest is keyed by session id, not by
 * branch — the file is `{session}.json` under `.plot/agents/`. Two branches
 * can share a session if one relaunched into the other; two sessions can name
 * the same branch if a manual dispatch followed an automatic one. The session
 * is the primary key the dispatcher minted, and it is the only identity this
 * endpoint needs.
 */

/** The session id, validated. A-z, digits, dashes — nothing that would escape a filename. */
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export interface DropOptions extends BuildBoardOptions {
  host: string;
  port: number;
  /**
   * Resolve liveness for a batch of worktrees. Injected in tests; in production
   * the default resolver reuses `plot-worker-state.sh` through `bashLiveness`.
   * When absent, the state stays `unknown` and the drop is REFUSED — an entry
   * whose state cannot be verified is an entry that might be running.
   */
  liveness?: LivenessResolver;
  /**
   * The manifest directory, already resolved — the test seam. When absent, the
   * directory is resolved through {@link resolveManifestDir} from `repoRoot` and
   * `scriptsDir`, EXACTLY as the reader does, so the Drop removes the file the
   * board is showing rather than a file in the board's own worktree.
   */
  manifestDir?: string;
}

/** What the drop can say, on both success and refusal. */
export interface DropResult {
  /** The session that was asked about. */
  session: string;
  /** True only when the manifest was actually removed. */
  dropped: boolean;
  /** Why not, when `dropped` is false — a human sentence. */
  reason: string;
}

/**
 * Availability for the drop route — the same binding question `/api/dispatch`
 * asks, exported so the board can carry it on the pulse.
 *
 * Loopback only, for the same reason every write route is: whoever reaches
 * localhost is sitting at the machine that owns the worktrees, and that IS
 * the permission.
 */
export function dropAvailability(host: string): { available: boolean; reason: string } {
  return localCapability(host, 'dropping an agent', 'the worktrees');
}

/**
 * Read the manifest for a session, or null if none exists.
 *
 * Returns the parsed entry with its state set to `unknown` — the caller must
 * resolve liveness separately. A manifest that cannot be parsed returns null
 * rather than throwing: a malformed manifest is a manifest that does not name
 * an agent, so there is nothing to drop.
 */
function readManifest(manifestDir: string, session: string): AgentEntry | null {
  const file = path.join(manifestDir, `${session}.json`);
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // No manifest for this session.
  }
  return parseManifest(content);
}

/**
 * Is this entry's worktree GONE — a path recorded, and no directory there?
 *
 * The distinction `classifyState` collapses. Three unlike situations reach it
 * as `unknown`: the probe said nothing recognisable, the resolver was missing,
 * and the worktree was deleted. Only the first two mean *might be alive*.
 *
 * A deleted worktree is not ambiguity — it is the most conclusive evidence
 * available that nothing is running there. Nothing runs in a directory that
 * does not exist, and no later check will ever make it verifiable, so the
 * advice the refusal used to give ("check the worktree manually") named a
 * directory the reader could not look at.
 *
 * Deliberately NOT a sixth {@link AgentEntry.state}: the five-member
 * `AgentStateSchema` is a published contract the board renders against, and
 * this question is asked at ONE decision point. It is a local predicate about
 * droppability, not a new thing an agent can be.
 *
 * An entry recording NO path returns false — that is the separate `!worktree`
 * case, an agent between checkouts, and absence of a path is not absence of an
 * agent.
 */
function worktreeIsGone(entry: AgentEntry): boolean {
  if (!entry.worktree) return false;
  return !fs.existsSync(entry.worktree);
}

/**
 * Classify one entry's state, reusing the injected liveness resolver.
 *
 * A batch-oriented resolver is overkill for one entry, but it is the same
 * code path the registry uses and calling it keeps the classification in one
 * place. An entry with no worktree stays `unknown` — there is nothing to look
 * in, and the drop is refused.
 */
function classifyState(
  entry: AgentEntry,
  liveness: LivenessResolver | undefined,
): AgentEntry['state'] {
  if (!entry.worktree) return 'unknown';
  if (!liveness) return 'unknown';
  try {
    const [answer] = liveness([entry.worktree]);
    if (answer === 'running' || answer === 'finished' || answer === 'waiting' || answer === 'stalled') {
      return answer;
    }
  } catch {
    // Liveness check failed — cannot verify, cannot drop.
  }
  return 'unknown';
}

/**
 * Handle `POST /api/registry/drop`. Removes a manifest if safe to do so.
 *
 * The loopback gate is NOT checked here: it is applied in the router, ahead of
 * every write route, so that a new endpoint cannot be added without it. See
 * `write-gate.ts` for why that placement is the point rather than a shortcut.
 */
export async function handleDrop(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: DropOptions,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (!isSameOrigin(req, opts.port)) {
    json(403, { error: 'cross-origin request refused' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const session = (body as { session?: unknown })?.session;
  if (typeof session !== 'string' || !SESSION_RE.test(session)) {
    json(400, { error: 'session must be a valid session id' });
    return;
  }

  // Resolve the manifest directory the SAME way the reader does — through
  // `plot-config.sh` with `.plot/agents` as the default — so the file this
  // endpoint reads and unlinks is the file the board is showing. Resolved once
  // and used for both the read and the unlink, so the two can never disagree.
  // #420 fixed the read path in `registry.ts`; joining the raw constant here left
  // the write path looking in the board's own worktree, which is how a drop
  // reported success over a manifest that still sat in the dispatcher's checkout.
  const manifestDir = resolveManifestDir(opts.repoRoot, opts);

  // 1. Read the manifest.
  const entry = readManifest(manifestDir, session);
  if (!entry) {
    // No manifest IN THE DIRECTORY THE READER READS — either already dropped or
    // never existed (a synthesized entry, or reconciliation got there first).
    // Report success idempotently: the caller wanted it gone and it is gone.
    // This is now an honest `dropped: true`, not the "I looked where the reader
    // does not look" that the old raw-constant join could return.
    json(200, { session, dropped: true, reason: 'no manifest found — already removed or never existed' } satisfies DropResult);
    return;
  }

  // 2. Classify the state — refuse live workers.
  const state = classifyState(entry, opts.liveness);
  if (LIVE_STATES.has(state)) {
    json(200, {
      session,
      dropped: false,
      reason: `cannot drop a ${state} worker — the agent is still running`,
    } satisfies DropResult);
    return;
  }

  // 3. An `unknown` state is NOT droppable — we cannot verify it is safe.
  //
  // UNLESS THE WORKTREE IS GONE. The refusal narrows here; it does not
  // disappear. `unknown` with a worktree that EXISTS still refuses, because
  // that is the live-worker case the guard was written for. `unknown` because
  // the directory was DELETED is the opposite situation wearing the same word:
  // the strongest possible evidence that nothing is running, which the guard
  // used to treat as though it were unmeasurable.
  //
  // Step 1 already sets the precedent — a missing MANIFEST drops with
  // `dropped: true`, "already removed or never existed". This asks the same
  // question about the WORKTREE, which it never did: there was a check for
  // `!entry.worktree` (no path recorded) and none for the path being recorded
  // and absent. Measured 2026-08-27: rows refused with advice to "check the
  // worktree manually", naming directories that did not exist.
  if (state === 'unknown' && !worktreeIsGone(entry)) {
    json(200, {
      session,
      dropped: false,
      reason: 'cannot drop an entry whose state could not be verified — check the worktree manually',
    } satisfies DropResult);
    return;
  }

  // 4. Safe to drop: `finished`, `stalled`, or an `unknown` whose worktree is
  // gone. The file is under the SAME resolved directory the manifest was read
  // from, never a re-join of the raw constant.
  const file = path.join(manifestDir, `${session}.json`);
  try {
    fs.unlinkSync(file);
  } catch (err) {
    // The file vanished between read and unlink — another process removed it.
    // Report success idempotently: the caller wanted it gone and it is gone.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      json(200, { session, dropped: true, reason: 'manifest removed by another process' } satisfies DropResult);
      return;
    }
    // Actual error — permission denied, disk full, etc.
    json(500, { error: `failed to remove manifest: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  json(200, {
    session,
    dropped: true,
    reason: `manifest removed — agent was ${state}`,
  } satisfies DropResult);
}
