import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import type { Decision, Write } from '../../workflows/decision.js';
import {
  HOLD_FILE,
  withPhase,
  withRecord,
  withSprintAnnotation,
  withoutHold,
} from '../../workflows/rendering.js';

/**
 * APPLIES A DECISION TO A REPOSITORY, and is the only thing in this package
 * that writes.
 *
 * The workflows decide and perform nothing; this performs and decides nothing.
 * Every branch here is a `switch` arm on a write's `kind` — there is no rule to
 * consult, no phase to check, and no refusal it can produce, because each of
 * those already happened before a `Decision` existed.
 *
 * IT IS AN ADAPTER BECAUSE IT TOUCHES THE DISK, and it is confined to
 * `adapters/` by the purity gate for exactly that reason. What it deliberately
 * does NOT do is reach the host or the process table: `pr-merge`, `worker-start`
 * and their neighbours are skipped rather than performed, so a sandbox running
 * this cannot merge a real PR or start a real agent no matter what a decision
 * says. The tier's premise is that nothing writes outside a temp repo, and this
 * is where that premise is enforced rather than promised.
 */

/** Where a decision is applied, and what it is allowed to reach. */
export interface PerformContext {
  /** The repository root the writes land in, absolute. */
  root: string;
}

/** What applying one decision did. */
export interface PerformReport {
  /** Every repository-relative path that was actually written. */
  written: readonly string[];
  /** Every write that was skipped because it reaches beyond the filesystem. */
  skipped: readonly Write['kind'][];
}

/**
 * The write kinds this performer deliberately does not perform.
 *
 * Each reaches the host or the process table. Naming them rather than falling
 * through a `default` is the same discipline the corpus tier's
 * `KNOWN_UNCARRIED` list applies: "skipped on purpose" and "a kind the author
 * forgot" look identical from inside a switch, and an unrecognised kind must
 * fail rather than pass silently.
 */
const BEYOND_THE_FILESYSTEM: ReadonlySet<Write['kind']> = new Set([
  'pr-ready',
  'pr-merge',
  'branch-create',
  'worktree-remove',
  'worktree-move',
  'worker-start',
  'worker-signal',
  'manifest-clear',
  'log-clear',
  'commit',
  'push',
]);

/**
 * Resolves a decision's path against the repository root.
 *
 * A decision names repository-relative paths, but `index-move` carries the
 * link paths a reading reported and those may arrive absolute. Both are
 * accepted and both land inside the root.
 *
 * @param context - where the writes land.
 * @param path - the path a write named.
 * @returns the absolute path on disk.
 */
const resolve = (context: PerformContext, path: string): string =>
  isAbsolute(path) ? path : join(context.root, path);

/**
 * Reports a path the way a decision names it, relative to the root.
 *
 * @param context - where the writes land.
 * @param path - the path a write named.
 * @returns the repository-relative path.
 */
const asRelative = (context: PerformContext, path: string): string =>
  isAbsolute(path) ? relative(context.root, path) : path;

/**
 * Reads a file, treating an absent one as empty.
 *
 * The hold file is the case this exists for: there is no `.plot/hold` in most
 * repositories, so the absent path is the common one and is never an error.
 *
 * @param file - the absolute path to read.
 * @returns the contents, or `''` where there is no such file.
 */
const readOrEmpty = (file: string): string =>
  existsSync(file) ? readFileSync(file, 'utf8') : '';

/**
 * Applies one write, reporting the paths it changed.
 *
 * @param context - where the writes land.
 * @param write - the write to apply.
 * @returns the repository-relative paths this write changed, empty when it
 *   found nothing to do.
 * @throws when the write's kind is neither performed nor deliberately skipped.
 */
const applyWrite = (context: PerformContext, write: Write): readonly string[] => {
  switch (write.kind) {
    case 'plan-phase': {
      const file = resolve(context, write.file);
      const next = withPhase(readOrEmpty(file), write.phase);
      if (!next.wrote) return [];
      writeFileSync(file, next.text);
      return [write.file];
    }

    case 'plan-record': {
      const file = resolve(context, write.file);
      const next = withRecord(readOrEmpty(file), write.field, write.value);
      if (!next.wrote) return [];
      writeFileSync(file, next.text);
      return [write.file];
    }

    case 'hold-clear': {
      const file = resolve(context, HOLD_FILE);
      const next = withoutHold(readOrEmpty(file), write.branch);
      if (!next.wrote) return [];
      writeFileSync(file, next.text);
      return [HOLD_FILE];
    }

    case 'sprint-annotation': {
      const file = resolve(context, write.file);
      const next = withSprintAnnotation(
        readOrEmpty(file),
        write.plan,
        write.status,
        write.pr,
        write.branch,
      );
      if (!next.wrote) return [];
      writeFileSync(file, next.text);
      return [write.file];
    }

    case 'index-move': {
      const from = resolve(context, write.from);
      const to = resolve(context, write.to);
      // A MOVE, not a copy. The link is how the estate browses by phase, and
      // `plot-reconcile-scan.sh` reports a plan linked from both directories as
      // drift — its printed fix is the removal this performs.
      const target = existsSync(from) ? linkTargetOf(from) : linkTargetOf(to);
      if (target === '') return [];
      mkdirSync(dirname(to), { recursive: true });
      rmSync(to, { force: true });
      symlinkSync(target, to);
      rmSync(from, { force: true });
      return [asRelative(context, write.from), asRelative(context, write.to)];
    }

    case 'plan-annotation':
    case 'sprint-note':
    case 'brief':
      // Named rather than skipped silently: each writes a file and none is
      // reachable from `approve` or `deliver`, which are the two workflows the
      // sandbox tier compares. A decision that emits one here would be applying
      // an untested encoding, so it fails rather than half-landing.
      throw new Error(`perform: '${write.kind}' has no sandbox encoding yet`);

    default:
      if (BEYOND_THE_FILESYSTEM.has(write.kind)) return [];
      throw new Error(`perform: unrecognised write kind '${String(write.kind)}'`);
  }
};

/**
 * Reads a symlink's target, treating a non-link as absent.
 *
 * @param link - the absolute path to read.
 * @returns the link's target, or `''` where the path is not a symlink.
 */
const linkTargetOf = (link: string): string => {
  try {
    // `readlinkSync` is imported lazily through `require`-free ESM by name
    // below; kept in one place so the failure mode is one `catch`.
    return readlinkOf(link);
  } catch {
    return '';
  }
};

/**
 * Reads a symlink's target.
 *
 * @param link - the absolute path to read.
 * @returns the target, verbatim as the link stores it.
 */
const readlinkOf = (link: string): string => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readlinkSync } = fsSync;
  return readlinkSync(link);
};

/** The one `node:fs` binding this file keeps beyond its named imports. */
import * as fsSync from 'node:fs';

/**
 * Applies every write a decision names, in the order it names them.
 *
 * Order matters and is the decision's: `pr-ready` precedes `pr-merge` because
 * a draft PR is not mergeable, and `reap` removes a worktree before the
 * manifest that named it. This performer keeps that order rather than
 * reordering by kind.
 *
 * @param context - where the writes land.
 * @param decision - the decision to apply.
 * @returns which paths were written and which kinds were skipped.
 * @throws when a write's kind is neither performed nor deliberately skipped.
 */
export const performDecision = (
  context: PerformContext,
  decision: Decision<unknown>,
): PerformReport => {
  const written: string[] = [];
  const skipped: Write['kind'][] = [];
  for (const write of decision.writes) {
    const paths = applyWrite(context, write);
    if (paths.length === 0 && BEYOND_THE_FILESYSTEM.has(write.kind)) skipped.push(write.kind);
    written.push(...paths);
  }
  return { written: [...new Set(written)].sort(), skipped };
};
