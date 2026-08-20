import fs from 'node:fs';
import path from 'node:path';

import { transcriptDir, transcriptFile, readTranscriptFacts } from './transcript.js';

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
  /** The branch it holds, or `''` while it holds none. */
  branch: string;
  worktree: string;
  /** The full `Worker command` as launched, quotes and newlines intact. */
  command: string;
  /** ISO-8601, written by the dispatcher at launch. */
  startedAt: string;
  /** From the transcript. Absent when it could not be read — never guessed. */
  model?: string;
  contextTokens?: number;
  lastActivity?: string;
}

/** Where the dispatcher writes manifests, relative to the repo root. */
export const AGENT_MANIFEST_DIR = '.plot/agents';

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
  return {
    session,
    branch: typeof o.branch === 'string' ? o.branch : '',
    worktree: typeof o.worktree === 'string' ? o.worktree : '',
    command: typeof o.command === 'string' ? o.command : '',
    startedAt: typeof o.startedAt === 'string' ? o.startedAt : '',
  };
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
 */
export function readAgentRegistry(repoRoot: string, home?: string): AgentEntry[] {
  const dir = path.join(repoRoot, AGENT_MANIFEST_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: AgentEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let entry: AgentEntry | null;
    try {
      entry = parseManifest(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    if (!entry) continue;
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
  // Newest first, by launch time. A manifest with no `startedAt` sorts last
  // rather than first: an unknown time must not claim to be the most recent.
  return out.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}
