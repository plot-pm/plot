import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { contextTokensFromUsage } from '@plot-pm/domain';

/**
 * What the session transcript can tell the panel about a live agent.
 *
 * **Every field is optional, and that is the contract rather than a weakness.**
 * The transcript is a PRIVATE, undocumented format belonging to the runtime,
 * which may move a field between releases without telling this board. So each
 * one is reported only when it is found and recognised, and omitted otherwise.
 *
 * The plan accepts that failure mode deliberately, and the reasoning is
 * load-bearing: *a stale model name read from a field that moved would be
 * believed, while an absent one prompts a look at the transcript.* Checking a
 * `version` and refusing unrecognised ones buys an error message at the price of
 * a second thing to keep current — and the fields it would guard are
 * conveniences, not facts anything depends on. Nothing in the board branches on
 * these; they are here to be read by a person.
 */
export interface TranscriptFacts {
  /** The model the last assistant turn ran on, e.g. `claude-opus-5`. */
  model?: string;
  /**
   * Tokens the last turn read back as context — `cache_read_input_tokens`.
   *
   * Named `contextTokens` rather than `cacheRead` because the number is being
   * shown to answer *how much context is in use*, and the cache is the
   * implementation detail that happens to record it.
   */
  contextTokens?: number;
  /**
   * Every input token the last turn carried, summed by the domain.
   *
   * **NOT `contextTokens`, and the two are kept apart deliberately.** That one
   * is `cache_read_input_tokens` alone and is what the panel has rendered since
   * 2026-08-19; this is `input_tokens` plus both cache fields, which is the
   * number a context ceiling is a fraction of. They differ by whatever the turn
   * just added — small on a settled agent, and largest exactly as one
   * approaches its ceiling.
   *
   * Renaming the older field to mean the sum was the alternative. It is refused
   * for the reason this repo's vocabulary section gives: two meanings for one
   * word is how `Wave`/`Slice` drifted, and the drift is silent because both
   * are plausible token counts.
   *
   * Summed by `contextTokensFromUsage` in `@plot-pm/domain` rather than here,
   * so the arithmetic a verdict depends on has one implementation.
   */
  contextSpend?: number;
  /** ISO-8601 timestamp of the last assistant turn — when the agent last spoke. */
  lastActivity?: string;
}

/**
 * Where the runtime keeps a session's transcript, from the directory the agent
 * runs in.
 *
 * The slug is the absolute cwd with `/` and `.` both replaced by `-`
 * (`/Users/x/plot-wt` → `-Users-x-plot-wt`). Measured 2026-08-19 against this
 * very worktree; the dots matter because worktree paths routinely contain them.
 *
 * Exported for test — the derivation is the part most likely to rot, and a test
 * that could only reach it through a filesystem read would not pin it down.
 */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[/.]/g, '-');
}

/**
 * The transcript directory for a worktree, under the runtime's home.
 *
 * `home` is injectable so tests need not write into the developer's real
 * `~/.claude` — which they would otherwise have to, since this path is
 * absolute by construction.
 */
export function transcriptDir(cwd: string, home = os.homedir()): string {
  return path.join(home, '.claude', 'projects', projectSlug(cwd));
}

/**
 * The one line of a transcript worth reading, given a session id — or null.
 *
 * **The NEWEST file wins when no session id is known, and sidechains are
 * excluded.** A worktree's transcript directory holds the session's own
 * `<uuid>.jsonl` beside `agent-<id>.jsonl` files written by its subagents
 * (measured: eleven of them in this worktree alone). A subagent's transcript
 * reports the subagent's model and its context, which is a true statement about
 * the wrong process — the panel is describing the worker, not the helpers it
 * spawned. `agent-` prefixed files are therefore skipped, and `isSidechain`
 * lines are skipped within a file for the same reason.
 *
 * A session id, when the caller has one, is exact and needs none of that
 * guessing. It is preferred wherever available.
 */
export function transcriptFile(dir: string, sessionId?: string): string | null {
  if (sessionId) {
    const exact = path.join(dir, `${sessionId}.jsonl`);
    return fs.existsSync(exact) ? exact : null;
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let newest: { file: string; mtime: number } | null = null;
  for (const entry of entries) {
    // See above: a subagent's transcript answers about the wrong process.
    if (!entry.endsWith('.jsonl') || entry.startsWith('agent-')) continue;
    const full = path.join(dir, entry);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (!newest || st.mtimeMs > newest.mtime) newest = { file: full, mtime: st.mtimeMs };
    } catch {
      // A file that vanished between readdir and stat is simply not the newest.
      continue;
    }
  }
  return newest?.file ?? null;
}

/**
 * How much of a transcript's tail to read, in bytes.
 *
 * A transcript grows without bound over a long run — six figures of tokens
 * become megabytes of JSONL — and everything this module wants is on the LAST
 * assistant line. 256 KiB is generous for that: a single line carrying a large
 * tool result can be tens of kilobytes, so the bound must hold several to be
 * sure of containing a complete one.
 *
 * Bounded like {@link readTail} in `worker-log.ts` and for the same reason: a
 * bound that allocates the file it is bounding is not a bound.
 */
export const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

/**
 * The last assistant line's facts, read defensively — or an empty object.
 *
 * **Reads backwards and stops at the first line it understands.** The last
 * assistant turn is the current state: the model in use, the context that turn
 * carried, and when the agent last spoke. Earlier lines describe a past that has
 * been superseded.
 *
 * **Every unrecognised shape yields absence, never a guess.** A file that will
 * not open, a tail with no complete line, a line that is not JSON, a line whose
 * `message.model` is missing or is not a string — each simply contributes
 * nothing. There is no throw to catch upstream and no placeholder to render,
 * because the panel's whole answer to an unreadable transcript is to show less.
 *
 * The field paths were MEASURED, not assumed (2026-08-19): `model` and `usage`
 * live under `message`, while `timestamp` is top-level. The plan's own summary
 * put `model` at the top level; reading it there returns undefined on every
 * line, and — because absence is silent by design — would have shipped a panel
 * that simply never showed these fields.
 */
export function readTranscriptFacts(file: string): TranscriptFacts {
  let text: string;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile()) return {};
      const length = Math.min(st.size, TRANSCRIPT_TAIL_BYTES);
      const buf = Buffer.allocUnsafe(length);
      const read = fs.readSync(fd, buf, 0, length, st.size - length);
      text = buf.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return {};
  }

  const lines = text.split('\n');
  // A tail that began mid-file starts mid-line; that fragment is not JSON and
  // would fail to parse anyway, but dropping it explicitly keeps the intent
  // visible rather than relying on a `catch` to launder it.
  if (text.length === TRANSCRIPT_TAIL_BYTES) lines.shift();

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof obj !== 'object' || obj === null) continue;
    const rec = obj as Record<string, unknown>;
    if (rec.type !== 'assistant') continue;
    // A subagent's turn is a true statement about the wrong process.
    if (rec.isSidechain === true) continue;

    // FROM HERE THIS LINE IS THE ANSWER. Everything below narrows a field or
    // leaves it absent — nothing may `continue`, because continuing would walk
    // back to an older turn and report ITS model as the agent's current one.
    // That is the stale-value failure this module exists to prevent, reached by
    // trying harder rather than by giving up; a test pins it.
    const message = rec.message;
    const msg =
      typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : {};

    const facts: TranscriptFacts = {};
    if (typeof msg.model === 'string' && msg.model !== '') facts.model = msg.model;
    const usage = msg.usage;
    if (typeof usage === 'object' && usage !== null) {
      const read = (usage as Record<string, unknown>).cache_read_input_tokens;
      // `Number.isFinite` rather than `typeof === 'number'`: a NaN that reached
      // the panel would render as "NaN tokens", which is a guess wearing a
      // number's clothes.
      if (typeof read === 'number' && Number.isFinite(read)) facts.contextTokens = read;
      // The sum a ceiling is a fraction of, decided in the domain. Null there
      // means no field was recognised, which stays an absence here rather than
      // becoming a zero — a renamed field must read as unknown, not as empty.
      const spend = contextTokensFromUsage(usage);
      if (spend !== null) facts.contextSpend = spend;
    }
    if (typeof rec.timestamp === 'string' && rec.timestamp !== '') {
      facts.lastActivity = rec.timestamp;
    }
    // The first assistant line found from the end IS the answer, even if it
    // yielded nothing recognisable. Continuing the scan would report an older
    // turn's model as the current one — the stale-value failure this module is
    // built to avoid, arrived at by trying harder.
    return facts;
  }
  return {};
}

/**
 * What the transcript says about the agent working in a worktree.
 *
 * Returns `{}` — never throws, never partially guesses — when the directory,
 * the file, or the line is missing or unrecognised.
 */
export function transcriptFacts(
  worktree: string,
  opts: { home?: string; sessionId?: string } = {},
): TranscriptFacts {
  const dir = transcriptDir(worktree, opts.home ?? os.homedir());
  const file = transcriptFile(dir, opts.sessionId);
  if (!file) return {};
  return readTranscriptFacts(file);
}
