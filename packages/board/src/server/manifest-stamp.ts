import fs from 'node:fs';
import path from 'node:path';
import { resolveManifestDir } from './registry.js';
import {
  deskManifest,
  type DeskManifest,
  type ManifestReading,
} from '@plot-pm/domain/rules/desk-manifest';

/**
 * The launch stamp — ONE contract, and this is one of its two implementations.
 *
 * A worker's pid is written into its manifest by whichever path started it, and
 * there are two. `/api/continue` spawns directly and calls {@link
 * writeManifestStamp}; the dispatcher's detached `sh -c` cannot reach a function
 * in this bundle, so it keeps inline `awk` against the SAME field set
 * (`plot-dispatch.sh`, `start_worker`). The two must produce a byte-identical
 * manifest for the same inputs — the `plot-worker-state.sh` discipline this repo
 * adopted after five of six states drifted while the same computation lived in
 * two copies. A parity test asserts the two agree.
 *
 * ## The defect this exists to fix
 *
 * The old stamp matched only the empty placeholder line `  "pid": "",` and so
 * fired exactly once per manifest. A relaunch in an existing worktree — the
 * board's *Continue with an answer* button, or a re-dispatch — found a filled
 * `"pid": "91471",`, matched nothing, and left the previous run's dead pid on
 * the row. The registry then named a process that had already exited.
 *
 * So the stamp must UPDATE a filled pid, not only fill an empty one. And a
 * relaunch is a signal worth keeping: `previousPid` names the corpse it replaced
 * (a fact `/api/continue` already computed to show *replacing pid Y* and then
 * discarded), and `relaunches` counts the restarts — a branch restarted three
 * times is struggling, and nothing else on the board can say so.
 *
 * ## Why a line rewriter and not JSON round-tripping
 *
 * The manifest is pretty-printed, one field per line, and the dispatcher writes
 * it with `printf` — not a JSON serializer. `awk` can only rewrite it line by
 * line. For the two implementations to stay byte-identical, this one rewrites
 * lines too: it never `JSON.parse`s the manifest and re-serializes it, because
 * that would re-order keys and reflow whitespace in ways `awk` cannot match. It
 * touches exactly the lines it must and inserts the two new lines in a fixed
 * place, which is a rule `awk` can follow to the byte.
 */
export interface Stamp {
  /** The AGENT's pid for the run being stamped, as a decimal string. */
  pid: string;
  /** ISO-8601 launch time of THIS run — rewritten on a relaunch. */
  startedAt: string;
  /**
   * The wrapper's pid — the process that owns the agent and outlives it to write
   * `.plot-worker.exit`. `''` when the caller does not know it.
   */
  wrapperPid?: string;
  /** The WorkerMonitor's pid, or `''` when none was attached. */
  workerMonitorPid?: string;
  /** The AgentMonitor's pid, or `''` when none was attached. */
  agentMonitorPid?: string;
  buildMonitorPid?: string;
}

/** The `"pid": "…",` line, capturing whatever pid it already held. */
const PID_LINE = /^ {2}"pid": "([^"]*)",$/;
/** The `"startedAt": "…"` line — the last launch field, no trailing comma. */
const STARTED_LINE = /^ {2}"startedAt": "[^"]*"$/;
/** An existing `"relaunches": N,` line, captured so a relaunch increments it. */
const RELAUNCHES_LINE = /^ {2}"relaunches": (\d+),$/;
/**
 * The three process-group lines, dropped wherever they already sit so a fresh
 * set can be emitted after `pid`.
 *
 * UNCONDITIONAL, unlike `previousPid`/`relaunches`: the group is re-emitted on
 * EVERY stamp, including a first dispatch, so a stale copy must go whether or
 * not this is a relaunch. Gating them on relaunch would duplicate the lines when
 * `/api/continue` stamps a manifest a first dispatch had already grouped.
 */
const GROUP_LINE = /^ {2}"(wrapperPid|workerMonitorPid|agentMonitorPid|buildMonitorPid)": "[^"]*",$/;

/**
 * Rewrite a manifest's launch stamp, returning the new text.
 *
 * FIRST DISPATCH (the pid line is empty): fill the pid, change nothing else. The
 * result is byte-for-byte what the dispatcher already produced before this
 * field carried any relaunch bookkeeping — no `previousPid`, no `relaunches`.
 *
 * RELAUNCH (the pid line is already filled): overwrite `pid` and `startedAt`
 * with the current run, record the displaced pid as `previousPid`, and increment
 * `relaunches` (starting from 0 when the manifest carries none). The two new
 * lines are inserted immediately after `pid`, in a fixed order, so the awk
 * implementation can place them identically.
 *
 * THE PROCESS GROUP is written on BOTH paths, immediately after `pid`, because
 * the registry must be able to name every process the dispatcher started — not
 * just the one doing the work. See the field docs on {@link Stamp}. A caller that
 * does not know a member passes `''`, which records *not attached* rather than
 * dropping the line: a reader distinguishes an absent field (an old manifest,
 * group unknown) from an empty one (this member was never started).
 *
 * The input text unchanged when there is no `pid` line to rewrite: a manifest
 * this shape is not one this stamp wrote, and it is left exactly as found rather
 * than corrupted.
 */
export function stampManifest(text: string, stamp: Stamp): string {
  const eol = text.endsWith('\n') ? '\n' : '';
  const lines = (eol ? text.slice(0, -1) : text).split('\n');

  let pidIdx = -1;
  let previousPid = '';
  for (let i = 0; i < lines.length; i++) {
    const m = PID_LINE.exec(lines[i]);
    if (m) {
      pidIdx = i;
      previousPid = m[1];
      break;
    }
  }
  if (pidIdx === -1) return text; // Not a manifest this stamp knows how to write.

  const group = [
    `  "wrapperPid": "${stamp.wrapperPid ?? ''}",`,
    `  "workerMonitorPid": "${stamp.workerMonitorPid ?? ''}",`,
    `  "agentMonitorPid": "${stamp.agentMonitorPid ?? ''}",`,
    `  "buildMonitorPid": "${stamp.buildMonitorPid ?? ''}",`,
  ];

  // A FIRST dispatch: the placeholder was empty. Fill the pid and write the
  // group after it. No `previousPid`, no `relaunches` — those are relaunch
  // bookkeeping and a first dispatch has none.
  if (previousPid === '') {
    lines[pidIdx] = `  "pid": "${stamp.pid}",`;
    const kept = lines.filter((l, i) => i === pidIdx || !GROUP_LINE.test(l));
    const at = kept.indexOf(lines[pidIdx]);
    kept.splice(at + 1, 0, ...group);
    return kept.join('\n') + eol;
  }

  // A RELAUNCH. Overwrite the current-run fields, count the restart, and keep
  // the corpse. `relaunches` may already be present (this is at least the second
  // relaunch), in which case its line is rewritten in place rather than added
  // again; `previousPid` is likewise rewritten if present.
  lines[pidIdx] = `  "pid": "${stamp.pid}",`;

  let relaunches = 1;
  const filtered: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === pidIdx) {
      filtered.push(lines[i]);
      continue;
    }
    const rm = RELAUNCHES_LINE.exec(lines[i]);
    if (rm) {
      relaunches = Number(rm[1]) + 1;
      continue; // Drop the old line; a fresh one is inserted after pid below.
    }
    if (/^ {2}"previousPid": "[^"]*",$/.test(lines[i])) {
      continue; // Likewise: re-inserted after pid with the freshly displaced pid.
    }
    if (GROUP_LINE.test(lines[i])) {
      continue; // Re-emitted after pid with THIS run's group.
    }
    if (STARTED_LINE.test(lines[i])) {
      filtered.push(`  "startedAt": "${stamp.startedAt}"`);
      continue;
    }
    filtered.push(lines[i]);
  }

  // Insert the group and the two relaunch lines immediately after the pid line —
  // a fixed position and a fixed order both implementations honour.
  const newPidIdx = filtered.indexOf(lines[pidIdx]);
  filtered.splice(
    newPidIdx + 1,
    0,
    ...group,
    `  "previousPid": "${previousPid}",`,
    `  "relaunches": ${relaunches},`,
  );
  return filtered.join('\n') + eol;
}



/**
 * Which manifest names a desk — `unnamed`, `named`, or `several` — read off
 * this board's registry directory.
 *
 * THE COLLECTION LOOP LIVES HERE ONCE. `manifestForWorktree` is built on this
 * and collapses `unnamed` and `several` to the same `''`, which served every
 * caller until `/api/continue` needed the two apart to word two different
 * refusals — a `several` desk is an estate defect worth naming, an `unnamed`
 * one is simply unregistered. Copying the loop a second time would be the
 * defect `deskManifest` itself was built to stop: four readers disagreeing on
 * how to find a manifest.
 *
 * THE DIRECTORY IS THE `Agent registry` KEY'S ANSWER, resolved by
 * {@link resolveManifestDir}. `opts` defaults to `{}`, the same relative
 * default as before.
 *
 * `unnamed` on any read failure — no agents directory, an unreadable file —
 * because a missing manifest is not an error: a caller may run the worker
 * regardless and treat the stamp as best-effort.
 *
 * @param repoRoot - the board's own checkout, for resolving a relative registry.
 * @param worktree - the desk to ask about.
 * @param opts - `manifestDir`/`scriptsDir` overrides, as {@link resolveManifestDir} takes them.
 * @returns which manifest names the desk, or that none or several do.
 */
export function deskManifestFor(
  repoRoot: string,
  worktree: string,
  opts: { manifestDir?: string; scriptsDir?: string } = {},
): DeskManifest {
  if (!worktree) return { kind: 'unnamed' };
  const dir = resolveManifestDir(repoRoot, opts);
  let real = worktree;
  try {
    real = fs.realpathSync(worktree);
  } catch {
    /* the worktree may be gone; match on the given path alone */
  }
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { kind: 'unnamed' };
  }
  const manifests: ManifestReading[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    try {
      const wt = JSON.parse(fs.readFileSync(full, 'utf8'))?.worktree;
      if (typeof wt !== 'string' || wt === '') continue;
      let wtReal: string | undefined;
      try {
        wtReal = fs.realpathSync(wt);
      } catch {
        /* the manifest may name a desk that is gone; its text is still a form */
      }
      manifests.push({ path: full, worktree: wt, worktreeReal: wtReal });
    } catch {
      continue; // Not a manifest this reader recognises; skip it.
    }
  }
  return deskManifest({ desk: worktree, deskReal: real, manifests });
}

/**
 * The manifest file that names this worktree, or `''` when none or several do.
 *
 * `/api/continue` knows the WORKTREE it is relaunching in but not the session id
 * the manifest is named for, so the file is found by matching the `worktree`
 * field rather than by rebuilding a path. The dispatcher records the RESOLVED
 * worktree path (`realpathSync`), while a pulse may hand back either form, so the
 * match is tried against both the path as given and its realpath.
 *
 * `''` on any failure — no agents directory, an unreadable file — because a
 * missing manifest is not an error: the worker runs regardless and the stamp is
 * a best-effort display fact. The caller treats `''` as *nothing to stamp*.
 *
 * Built on {@link deskManifestFor} — see there for the directory resolution and
 * the collection loop. `unnamed` and `several` collapse to `''` here, because
 * this reader's only callers want a single path to stamp or nothing; a caller
 * that needs the two apart asks {@link deskManifestFor} directly.
 */
export function manifestForWorktree(
  repoRoot: string,
  worktree: string,
  opts: { manifestDir?: string; scriptsDir?: string } = {},
): string {
  const answer = deskManifestFor(repoRoot, worktree, opts);
  return answer.kind === 'named' ? answer.path : '';
}

/**
 * Stamp a manifest ON DISK, atomically.
 *
 * Read, rewrite via {@link stampManifest}, write through a temp file in the same
 * directory and `rename` into place — the discipline the dispatcher already uses,
 * so a scan reading the directory never sees a half-written manifest.
 *
 * A NO-OP on any failure, never a throw. The worker is already running when this
 * is called; a manifest that cannot be read or written costs an inaccurate row,
 * not the run, and the registry already reads an absent pid as `unknown`. The
 * caller has nothing to recover, so nothing is raised at it.
 *
 * Returns true when the stamp landed, false otherwise — for a test that wants to
 * assert the write happened, never for control flow the caller must branch on.
 */
export function writeManifestStamp(manifestPath: string, stamp: Stamp): boolean {
  let text: string;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    return false;
  }
  const out = stampManifest(text, stamp);
  const tmp = `${manifestPath}.plot-pid-tmp`;
  try {
    fs.writeFileSync(tmp, out, 'utf8');
    fs.renameSync(tmp, manifestPath);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing to clean up */
    }
    return false;
  }
}

/**
 * Replaces a manifest's `resumeId` on disk, atomically.
 *
 * The loop reads the conversation to resume from this field. A new id names no
 * transcript, so the next run creates a session. The rewrite parses and
 * re-serialises the manifest the way the loop's own hop does
 * (`update_manifest_on_hop`), and every other field is kept.
 *
 * @param manifestPath - the manifest file.
 * @param resumeId - the new, non-empty id.
 * @returns true when the new id landed, false where the manifest could not be
 *   read, parsed or written, or where `resumeId` is empty.
 */
export const writeResumeId = (manifestPath: string, resumeId: string): boolean => {
  if (resumeId === '') return false;
  const tmp = `${manifestPath}.plot-resume-tmp`;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
    manifest.resumeId = resumeId;
    fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, manifestPath);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing to clean up */
    }
    return false;
  }
};
