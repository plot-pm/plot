import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { AGENT_MANIFEST_DIR, parseManifest, type AgentEntry, type LivenessResolver } from './registry.js';
import { LIVE_STATES } from '../contract/schema.js';

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
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return { available: true, reason: '' };
  }
  return {
    available: false,
    reason: `the board is bound to ${host}, not localhost — dropping an agent is available only on the machine that owns the worktrees`,
  };
}

/**
 * Read the manifest for a session, or null if none exists.
 *
 * Returns the parsed entry with its state set to `unknown` — the caller must
 * resolve liveness separately. A manifest that cannot be parsed returns null
 * rather than throwing: a malformed manifest is a manifest that does not name
 * an agent, so there is nothing to drop.
 */
function readManifest(repoRoot: string, session: string): AgentEntry | null {
  const file = path.join(repoRoot, AGENT_MANIFEST_DIR, `${session}.json`);
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // No manifest for this session.
  }
  return parseManifest(content);
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

  // 1. Read the manifest.
  const entry = readManifest(opts.repoRoot, session);
  if (!entry) {
    // No manifest — either already dropped or never existed. Report success
    // idempotently: the caller wanted it gone and it is gone.
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
  if (state === 'unknown') {
    json(200, {
      session,
      dropped: false,
      reason: 'cannot drop an entry whose state could not be verified — check the worktree manually',
    } satisfies DropResult);
    return;
  }

  // 4. State is `finished` or `stalled` — safe to drop.
  const file = path.join(opts.repoRoot, AGENT_MANIFEST_DIR, `${session}.json`);
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
