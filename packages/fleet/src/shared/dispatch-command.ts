import fs from 'node:fs';
import {
  dispatchReadingFor,
  type DispatchReading,
  type DispatchReadingFor,
  type NamedBranchRefusal,
} from '@plot-pm/domain/rules/auto-dispatch';
import type { FleetReading } from '@plot-pm/domain';
import { DISPATCH_SCRIPT, dispatchLogPath, scriptsOf, type ActOptions } from './action-log.js';
import { recordActionReceipt } from './action-receipt.js';
import { migrateAgentLogs } from './agent-log.js';
import type { BoardConfigReader } from './board-run.js';
import { readConfig } from './config-reader.js';
import {
  IMPLEMENT_COMMAND_KEY,
  implementLogPath,
  heldImplementLock,
  implementLockRefusal,
  startImplement,
} from './implement-run.js';
import { usableCommand } from './usable-command.js';

/** A branch name a caller may pass: a git ref name with no leading `-`. Rejected rather than sanitized. */
export const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/**
 * The optional `branch` of a request body.
 *
 * @param body - the parsed request body.
 * @returns `{}` where the body names no branch, `{ branch }` for a valid name, or `null` for any other value.
 */
export const bodyBranch = (body: unknown): { branch?: string } | null => {
  const branch = (body as { branch?: unknown } | null)?.branch;
  if (branch === undefined) return {};
  return typeof branch === 'string' && BRANCH_RE.test(branch) ? { branch } : null;
};

/** `--max 1`: one dispatch is ONE decision. Fanning out a plan stays with `/plot-dispatch`. */
export const MAX_PER_CLICK = '1';

/** A plan slug, as `plot-dispatch.sh` finds a plan file with it. Rejected rather than sanitized. */
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** How a dispatch ended once its implement run did. */
export interface DispatchEnd {
  /** Whether `plot-dispatch.sh` was started. */
  dispatched: boolean;
  /** The implement run's recorded exit code. */
  code: number;
  /** Why the dispatch was not started after a clean implement; absent otherwise. */
  error?: string;
}

/** What starting a dispatch came to. */
export type DispatchStart =
  | {
      kind: 'refused';
      status: 409;
      reason: 'no-implement-command' | 'implement-running' | 'nothing-startable' | NamedBranchRefusal;
      detail: string;
      /** The running implement's log; present for `implement-running`. */
      log?: string;
    }
  | { kind: 'failed'; error: string }
  | {
      kind: 'started';
      /** Where the implement run writes. */
      implementLog: string;
      /** Where the dispatch writes; written only when the implement exits 0. */
      dispatchLog: string;
      /** Settles once the implement run has ended and, on exit 0, `plot-dispatch.sh` has been started. */
      ended: Promise<DispatchEnd>;
    };

/** What {@link startDispatch} needs. */
export interface DispatchInput {
  /** Where the repository and its scripts are; `scripts` replaces the shell adapter. */
  opts: ActOptions;
  /** The plan slug, already matched against {@link SLUG_RE}. */
  slug: string;
  /** The one branch to start, already matched against {@link BRANCH_RE}; the first startable branch where absent. */
  branch?: string;
  /** Reads `## Plot Config` keys; {@link readConfig} where absent. */
  readCfg?: BoardConfigReader;
  /** What the pulse says about starting the plan at `branch`; see {@link dispatchReadingFor}. */
  startReading: (slug: string, branch?: string) => DispatchReadingFor;
}

/**
 * What the pulse says about starting `slug`, at `branch` where one is named.
 *
 * @param pulse - a fleet reading, or `null` where there is none.
 * @param slug - the plan slug.
 * @param branch - the branch the caller names, or `undefined`.
 * @returns the reading; see {@link dispatchReadingFor}.
 */
export const startReadingFromPulse = (pulse: FleetReading | null, slug: string, branch?: string): DispatchReadingFor =>
  dispatchReadingFor(pulse, slug, branch);

/**
 * The branch an implement run briefs for a reading, or `null` for a branchless run.
 *
 * @param reading - the reading.
 * @returns the branch of a `branch` reading, else `null`.
 */
export const briefBranchOf = (reading: DispatchReadingFor): string | null =>
  reading.kind === 'branch' ? reading.branch : null;

/**
 * The refusal detail for a `held` reading: each held branch and what it waits on.
 *
 * @param reading - a `held` reading.
 * @returns one sentence per held branch, joined by `; `.
 */
export const nothingStartableDetail = (reading: Extract<DispatchReading, { kind: 'held' }>): string => {
  const parts = reading.held.map((h) => {
    const names = h.waits_on;
    const prerequisite =
      names.length === 0
        ? 'an unnamed prerequisite'
        : names.length === 1
          ? (names[0] as string)
          : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const missing = names.length > 1 ? 'one of which has no pull request' : 'which has no pull request';
    return `${h.branch} ${h.state === 'blocked' ? `waits for ${prerequisite}, ${missing}` : `waits for ${prerequisite}`}`;
  });
  return `nothing to start: ${parts.join('; ')}`;
};

/**
 * Starts a dispatch: refuses, or runs `/plot-implement` and, only when it exits
 * 0, records the `dispatch` receipt and starts `plot-dispatch.sh`.
 *
 * The receipt is written in the exit handler, immediately before the start it
 * announces. A receipt written earlier would admit a start that the implement
 * may still refuse.
 *
 * @param input - the repository, the slug, and how to read config and the brief branch.
 * @returns a refusal with its reason, a failure to open the implement log, or the started run.
 */
export const startDispatch = (input: DispatchInput): DispatchStart => {
  const { opts, slug } = input;
  const readCfg = input.readCfg ?? readConfig;
  const implCommand = usableCommand(readCfg(opts, IMPLEMENT_COMMAND_KEY, ''));
  if (!implCommand) {
    return {
      kind: 'refused',
      status: 409,
      reason: 'no-implement-command',
      detail: `no \`${IMPLEMENT_COMMAND_KEY}\` in Plot Config — starting work requires a brief, and the brief requires the /plot-implement SKILL; add the key or run /plot-implement yourself first`,
    };
  }
  const reading = input.startReading(slug, input.branch);
  if (reading.kind === 'branch-refused') {
    return { kind: 'refused', status: 409, reason: reading.reason, detail: reading.detail };
  }
  if (reading.kind === 'held') {
    return { kind: 'refused', status: 409, reason: 'nothing-startable', detail: nothingStartableDetail(reading) };
  }
  const implementLog = implementLogPath(opts.repoRoot, slug);
  const holding = heldImplementLock(opts.repoRoot, slug);
  if (holding !== null) {
    const refusal = implementLockRefusal(opts.repoRoot, slug, holding);
    return {
      kind: 'refused',
      status: 409,
      reason: 'implement-running',
      detail: `${refusal.detail}; wait for it to finish before dispatching again`,
      log: refusal.log ?? implementLog,
    };
  }
  const dispatchLog = dispatchLogPath(opts.repoRoot, slug);
  let settle: (end: DispatchEnd) => void = () => {};
  const ended = new Promise<DispatchEnd>((resolve) => {
    settle = resolve;
  });
  const started = startImplement(
    opts,
    slug,
    implCommand,
    (code) => {
      if (code !== 0) {
        settle({ dispatched: false, code });
        return;
      }
      try {
        migrateAgentLogs(opts.repoRoot);
        const out = fs.openSync(dispatchLog, 'a');
        try {
          recordActionReceipt(opts.repoRoot, 'dispatch', slug);
          const only = input.branch === undefined ? [] : ['--branch', input.branch];
          scriptsOf(opts).start(DISPATCH_SCRIPT, ['--max', MAX_PER_CLICK, ...only, slug], {
            log: out,
            onError: (err) => console.error('dispatch failed to spawn:', err),
          });
        } finally {
          fs.closeSync(out);
        }
        settle({ dispatched: true, code });
      } catch (err) {
        settle({ dispatched: false, code, error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
    readCfg,
    briefBranchOf(reading),
  );
  if ('failure' in started) {
    return started.failure.running
      ? { kind: 'refused', status: 409, reason: 'implement-running', detail: started.failure.detail, log: started.failure.log ?? implementLog }
      : { kind: 'failed', error: started.failure.detail };
  }
  return { kind: 'started', implementLog, dispatchLog, ended };
};
