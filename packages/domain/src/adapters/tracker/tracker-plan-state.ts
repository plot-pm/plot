import { createHash } from 'node:crypto';
import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import { filled, planIssueComment, priorPlanLinesOf, PLAN_STATE_MARKER } from '../../rules/plan-issue-comment.js';
import type { PlanStatePhase, PlanStateOutcome, PlanStateWrite } from '../../ports/tracker.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { unaskableReasonOf } from './tracker-shell.js';

/** The phases, in the order their labels are named. */
const PHASES: readonly PlanStatePhase[] = ['draft', 'approved', 'delivered', 'released'];

/**
 * The `plan:*` label a phase sets.
 *
 * @param phase - the plan's phase.
 * @returns `plan:<phase>`.
 */
export const planStateLabel = (phase: PlanStatePhase): string => `plan:${phase}`;

/**
 * The comma-separated `plan:*` labels a write removes, so an issue carries one.
 *
 * @param phase - the phase being set, which is kept.
 * @returns every other phase's label.
 */
export const planStateLabelsToRemove = (phase: PlanStatePhase): string =>
  PHASES.filter((other) => other !== phase)
    .map(planStateLabel)
    .join(',');

export { PLAN_STATE_MARKER };

/** The issue number an identifier ends in, or null where it names none. */
const numberOf = (issue: string): string | null => /(\d+)\s*$/.exec(issue)?.[1] ?? null;

/** The environment variable naming the body-hash record's directory, for tests. */
export const PLAN_STATE_WRITTEN_HOME_ENV = 'PLOT_PLAN_STATE_WRITTEN_HOME';

/** The body-hash record's filename, under the common git dir's `.plot/state/`. */
const WRITTEN_FILE = 'plan-state-written.json';

/** One issue's last-written body hash, keyed by issue identifier. */
type WrittenHashes = Record<string, string>;

/** A body's hash, as compared across writes. Not a security hash — only equality matters. */
const hashOf = (body: string): string => createHash('sha256').update(body).digest('hex');

/**
 * The common git dir's `.plot/state/` directory for this checkout, or null
 * where it could not be resolved.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, resolved against `cwd`, so a
 * desk and the main checkout name the same record.
 */
const stateDirOf = async (cwd: string, env: Record<string, string | undefined>): Promise<string | null> => {
  const override = env[PLAN_STATE_WRITTEN_HOME_ENV];
  if (override !== undefined && override !== '') return override;
  const run = await runProcess('git', ['rev-parse', '--git-common-dir'], { cwd });
  const out = run.stdout.trim();
  if (run.code !== 0 || out === '') return null;
  return join(resolve(cwd, out), '.plot', 'state');
};

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Reads the body-hash record, or an empty record where there is none or it
 * cannot be read — a cold or unreadable record never blocks a write; it only
 * loses the level trigger for one tick.
 */
const readWrittenHashes = async (path: string): Promise<WrittenHashes> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as WrittenHashes) : {};
  } catch (error) {
    return isMissing(error) ? {} : {};
  }
};

/**
 * Records `issue`'s newly-written body hash, leaving every other issue's
 * entry untouched.
 */
const writeWrittenHash = async (dir: string, issue: string, hash: string): Promise<void> => {
  const path = join(dir, WRITTEN_FILE);
  await mkdir(dir, { recursive: true });
  const hashes = await readWrittenHashes(path);
  hashes[issue] = hash;
  await writeFile(path, `${JSON.stringify(hashes, null, 2)}\n`, 'utf8');
};

/**
 * Holds one issue's write the whole time between reading its comment and
 * posting the replacement, so two writers never both find no marked comment.
 *
 * A plain `link()` mutex: `link()` is atomic across processes, and the target
 * either did not exist (this caller now owns the lock) or did (contended).
 * Narrower than a reader-election lock — this is one short critical section
 * per write, not a standing role — so {@link ../reader-lock/reader-lock-file.js}
 * is the wrong shape here and is not reused.
 *
 * A lock whose holder died without releasing it is cleared after
 * {@link LOCK_STALE_MS}: a crash between acquiring and releasing must not wedge
 * every future write to that issue.
 */
const LOCK_STALE_MS = 60_000;

/** How long to wait, and how often to retry, acquiring a contended lock. */
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 50;

/**
 * Acquires the per-issue lock at `<dir>/plan-state-<issue>.lock`, waiting out
 * contention up to {@link LOCK_WAIT_MS} and breaking a lock older than
 * {@link LOCK_STALE_MS}.
 *
 * @param dir - the `.plot/state/` directory.
 * @param issue - the issue identifier the lock is scoped to.
 * @returns a release function; always resolves, even on a timed-out wait —
 *   the write proceeds unlocked rather than silently skipping forever.
 */
const withIssueLock = async (dir: string, issue: string): Promise<() => Promise<void>> => {
  await mkdir(dir, { recursive: true });
  const lockPath = join(dir, `plan-state-${issue.replace(/[^A-Za-z0-9_-]/g, '_')}.lock`);
  const marker = `${lockPath}.${process.pid}.${Math.floor(Math.random() * 1e9)}`;
  await writeFile(marker, '', 'utf8');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await link(marker, lockPath);
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') break;
      try {
        const age = Date.now() - (await stat(lockPath)).mtimeMs;
        if (age > LOCK_STALE_MS) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        // The lock file vanished between the failed link and this check — retry.
      }
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  await unlink(marker).catch(() => {});
  return async () => {
    await unlink(lockPath).catch(() => {});
  };
};

/**
 * Performs a plan-state write on a GitHub issue through `plot-host.sh`.
 *
 * Level-triggered and locked: holds the per-issue lock for the whole
 * sequence, reads the marked comment back ONLY where `write` names no
 * progress or no tickets (D6's one sanctioned read-back), fills the absent
 * fields from what that comment held, and skips the label-and-comment steps
 * entirely where the owed body's hash matches the last body written for this
 * issue. The `released` close still runs on every call, because closing is
 * not level-triggered — closing twice is a no-op `gh` refuses harmlessly, and
 * the hash gate must not also suppress it.
 *
 * @param context - where the scripts and the repository are.
 * @param env - the environment the calling connector runs `plot-host.sh` under.
 * @param refuse - records the refusal the calling connector's `lastRefusal` reports.
 * @returns the connector's `planStateWrite`: `written`; `no-target` where the
 *   issue names no number; `unaskable` on exit 4; `failed` otherwise.
 */
export const githubPlanStateWrite =
  (context: ShellContext, env: Record<string, string>, refuse: (said: string | null) => void) =>
  async (write: PlanStateWrite): Promise<PortResult<PlanStateOutcome>> => {
    const number = numberOf(write.issue);
    if (number === null) {
      refuse(null);
      return answered<PlanStateOutcome>('no-target');
    }
    const host = scriptPath(context, 'plot-host.sh');
    const run = async (args: string[]) => runProcess('bash', [host, ...args], { cwd: context.repoRoot, env });

    const dir = await stateDirOf(context.repoRoot, env);
    const release = dir === null ? async () => {} : await withIssueLock(dir, write.issue);
    try {
      let effective = write;
      if (write.sliceProgress === undefined || write.highTickets === undefined) {
        const said = await run(['issue-comment-read', number, PLAN_STATE_MARKER]);
        const prior = said.code === 0 && said.stdout.trim() !== '' ? priorPlanLinesOf(said.stdout) : null;
        effective = filled(write, prior);
      }
      const body = planIssueComment(effective);
      const hash = hashOf(body);
      const alreadyWritten = dir !== null && (await readWrittenHashes(join(dir, WRITTEN_FILE)))[write.issue] === hash;

      if (!alreadyWritten) {
        const steps: string[][] = [
          ['issue-label', number, planStateLabel(write.phase), planStateLabelsToRemove(write.phase)],
          ['issue-comment', number, PLAN_STATE_MARKER, body],
        ];
        for (const step of steps) {
          const said = await run(step);
          if (said.code === 4) {
            refuse(null);
            return unaskable(unaskableReasonOf(said.stderr));
          }
          if (said.code !== 0) {
            refuse(said.stderr.trim() || said.stdout.trim() || `plot-host.sh ${step[0]} exited ${said.code}`);
            return failed();
          }
        }
        if (dir !== null) await writeWrittenHash(dir, write.issue, hash);
      }

      if (write.phase === 'released') {
        const said = await run(['issue-close', number]);
        if (said.code === 4) {
          refuse(null);
          return unaskable(unaskableReasonOf(said.stderr));
        }
        if (said.code !== 0) {
          refuse(said.stderr.trim() || said.stdout.trim() || `plot-host.sh issue-close exited ${said.code}`);
          return failed();
        }
      }
      refuse(null);
      return answered<PlanStateOutcome>('written');
    } finally {
      await release();
    }
  };
