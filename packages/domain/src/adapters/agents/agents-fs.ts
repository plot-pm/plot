import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { AgentDesk, AgentManifest, Agents } from '../../ports/agents.js';
import { scriptsShell } from '../scripts/scripts-shell.js';
import type { ShellContext } from '../scripts.js';

/**
 * THE ONE PLACE AN AGENT'S PATHS APPEAR.
 *
 * Every constant below is a filename the board spelled out at 31 sites before
 * this adapter existed. They are here and nowhere else: a caller asks
 * {@link Agents} about an agent's question, its declaration or its ending, and
 * learns none of these names.
 */

/** Where the dispatcher writes manifests, relative to the repository root. */
const MANIFEST_DIR = '.plot/agents';

/** The `## Plot Config` key that may point the registry somewhere else. */
const MANIFEST_DIR_KEY = 'Agent registry';

/** The prefix of the file a stopped agent writes to ask a person something. */
const MARKER_PREFIX = 'PLOT-BLOCKED';

/** The desk's own record of the pid it launched. */
const PID_FILE = '.plot-worker.pid';

/** The desk's own record of how the worker ended. */
const EXIT_FILE = '.plot-worker.exit';

/**
 * How much of a marker line a row can carry.
 *
 * A note sits on one board row beside a branch name, so the budget is what fits
 * there rather than what a worker wrote. A clipped question still names its
 * subject, which is the whole job of the note.
 */
export const QUESTION_MAX = 120;

/** A file's contents, or `null` where it could not be read for any reason. */
const fileOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * A pid off a record, as a validated string — or `''` when there is none to
 * trust.
 *
 * `0` and non-numeric junk are refused for the reason `plot-worker-state.sh`
 * refuses them: `kill -0 0` signals the whole process group and reads as running
 * forever, and junk is not a pid at all. The ONE rejection point, so a bad value
 * fails as absent rather than as a `running` later.
 */
const readPid = (raw: unknown): string => {
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  return /^\d+$/.test(s) && Number(s) > 0 ? s : '';
};

/** A string field off a manifest, or `''` where it carries none usable. */
const readText = (raw: unknown): string => (typeof raw === 'string' ? raw : '');

/** A non-negative integer field off a manifest, or `0`. */
const readCount = (raw: unknown): number =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;

/**
 * One manifest's JSON → one declaration, or `null`.
 *
 * The bar is deliberately low and it is `registry.ts`'s: a `session` string is
 * the only requirement, because it is the key everything else joins on. Every
 * other field takes its empty value rather than rejecting the entry — a manifest
 * written by an older dispatcher must still name its agent, since an agent
 * nobody can see is one that gets restarted into work it already holds.
 */
export const parseManifest = (json: string): AgentManifest | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const session = readText(o.session).trim();
  if (session === '') return null;
  return {
    session,
    // NOT DEFAULTED TO `session`. A manifest written before this field existed
    // asserts no resume handle, and filling one in from the join key would
    // invent a claim the file never made.
    resumeId: readText(o.resumeId),
    branch: readText(o.branch),
    slug: readText(o.slug),
    worktree: readText(o.worktree),
    command: readText(o.command),
    startedAt: readText(o.startedAt),
    pid: readPid(o.pid),
    // Read leniently, because unlike `pid` nothing checks liveness against it.
    previousPid: readText(o.previousPid),
    relaunches: readCount(o.relaunches),
    attempts: readCount(o.attempts),
  };
};

/**
 * The first non-empty line of a marker file, trimmed and bounded.
 *
 * LEADING COMMENT SYNTAX IS STRIPPED. A marker written into a source file
 * arrives as `// PLOT-BLOCKED: which adapter?`, and the punctuation is an
 * artefact of where the worker put it rather than part of what it asked. The
 * TRAILING side is left alone: stripping from both ends invites eating the
 * question mark, which is the one character that makes the note read as a
 * question at all.
 *
 * @param text - the marker file's contents.
 * @param max - how many characters a note may carry.
 * @returns the question, or `''` where the file said nothing.
 */
export const firstMarkerLine = (text: string, max = QUESTION_MAX): string => {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  if (line === undefined) return '';
  const bare = line.replace(/^(?:\/\/+|#+|\*+|--|<!--)\s*/, '').trim();
  if (bare === '') return '';
  return bare.length > max ? `${bare.slice(0, max - 1).trimEnd()}…` : bare;
};

/**
 * The `PLOT-BLOCKED*` files at a desk's root, and the first one's first line.
 *
 * ROOT ONLY, mirroring `plot_worker_blocked`: every observed marker sits at the
 * root, and matching at depth would re-admit looseness the board removed
 * deliberately.
 *
 * BY FILENAME AND NEVER BY CONTENTS. A grep for the token matched a brief or a
 * CLAUDE.md that merely documented it and surfaced the mention as a worker's
 * question; a document is not a `PLOT-BLOCKED*` file, so the exclusion is a
 * property of the name rather than a flag that could be forgotten.
 */
const readMarkers = (worktree: string): { markers: string[]; question: string } => {
  let names: string[];
  try {
    names = readdirSync(worktree);
  } catch {
    return { markers: [], question: '' };
  }
  const markers: string[] = [];
  let question = '';
  for (const name of names.sort()) {
    if (!name.startsWith(MARKER_PREFIX)) continue;
    const full = join(worktree, name);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    markers.push(name);
    if (question === '') {
      const text = fileOrNull(full);
      // A name that matched but would not read leaves the question empty and
      // the marker listed. The desk IS blocked either way; only what it asks
      // is unavailable, and those are two different facts.
      if (text !== null) question = firstMarkerLine(text);
    }
  }
  return { markers, question };
};

/**
 * Where this repository's registry lives, absolute.
 *
 * A relative configured value — the common case — is joined against the
 * repository; an absolute one is taken as-is, so a project may name a registry
 * outside its own tree. An unreadable config answers the default rather than
 * failing: the registry must never go unread for want of a config lookup.
 */
const manifestDir = async (context: ShellContext, override?: string): Promise<string> => {
  const configured =
    override ??
    (await (async () => {
      const answer = await scriptsShell(context).config(MANIFEST_DIR_KEY, MANIFEST_DIR);
      return (answer.ok ? answer.value.trim() : '') || MANIFEST_DIR;
    })());
  return isAbsolute(configured) ? configured : join(context.repoRoot, configured);
};

/** What a caller may resolve for itself rather than have this adapter ask. */
export interface AgentsFsOptions {
  /**
   * The registry directory, already resolved.
   *
   * The test seam, and a caller that has resolved it itself. Absent, the
   * directory is read from `## Plot Config` once per call.
   */
  manifestDir?: string;
}

/**
 * Reads agents from the filesystem — the production {@link Agents}.
 *
 * **A FILE READ, NOT A SPAWN, AND THEREFORE NOT A SCRIPT.** The same division
 * `performer-shell.ts` draws when it writes a manifest: the process table is the
 * script's to touch, and a manifest is a JSON file this package already reads.
 * Inventing a script to read one would put a second definition of the manifest's
 * shape in a language that cannot share the first.
 *
 * `plot-config.sh` IS reached, through the `Scripts` port, because *where is
 * this repository's registry* is a config question and `plot-config.sh` is the
 * one answer to it.
 *
 * @param context - the repository and where its helper scripts live.
 * @param options - what the caller has already resolved.
 * @returns an `Agents` reading this machine's filesystem.
 */
export const agentsFs = (context: ShellContext, options: AgentsFsOptions = {}): Agents => ({
  declared: async (): Promise<PortResult<readonly AgentManifest[]>> => {
    const dir = await manifestDir(context, options.manifestDir);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      // NO DIRECTORY IS `failed`, NOT AN EMPTY ANSWER. A registry that is not
      // there was never written to, and a caller that reads that as *this
      // estate has no agents* cannot tell it from one that has none — which is
      // the distinction `PortResult` exists to keep.
      return failed<readonly AgentManifest[]>();
    }
    const out: AgentManifest[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const text = fileOrNull(join(dir, name));
      if (text === null) continue;
      const entry = parseManifest(text);
      // An unparseable file costs its own entry and never the listing. The
      // board renders this on the scan's timer, and a throw here would cost
      // the whole pulse.
      if (entry !== null) out.push(entry);
    }
    return answered(out);
  },

  declaration: async (session): Promise<PortResult<AgentManifest>> => {
    const dir = await manifestDir(context, options.manifestDir);
    const text = fileOrNull(join(dir, `${session}.json`));
    if (text === null) return failed<AgentManifest>();
    const entry = parseManifest(text);
    return entry === null ? failed<AgentManifest>() : answered(entry);
  },

  desk: async (worktree): Promise<PortResult<AgentDesk>> => {
    try {
      if (!statSync(worktree).isDirectory()) return failed<AgentDesk>();
    } catch {
      // A DESK THAT IS NOT HERE IS `failed`, and the caller decides what that
      // means. `rules/agent-state.ts` reads it as `elsewhere`; the supervisor
      // reads an unreadable desk as blocked. Answering empty readings would
      // make both of those impossible to tell from a desk holding nothing.
      return failed<AgentDesk>();
    }
    const { markers, question } = readMarkers(worktree);
    return answered({
      question,
      markers,
      pid: readPid(fileOrNull(join(worktree, PID_FILE))),
      // `null` IS THE RECORD'S ABSENCE AND `''` IS AN UNREADABLE RECORD, and
      // they are kept apart because `rules/agent-state.ts` reaches `ended` by
      // both routes and says so. A worker killed outright left no file; one
      // whose wrapper died mid-write left a file saying nothing.
      exit: fileOrNull(join(worktree, EXIT_FILE))?.trim() ?? null,
    });
  },
});
