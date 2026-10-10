import fs from 'node:fs';
import { startableBranches } from '@plot-pm/domain/rules/auto-dispatch';
import type { FleetReading } from '@plot-pm/domain';
import { DISPATCH_SCRIPT, dispatchLogPath, scriptsOf, type ActOptions } from './action-log.js';
import { recordActionReceipt } from './action-receipt.js';
import { migrateAgentLogs } from './agent-log.js';
import type { BoardConfigReader } from './board-run.js';
import { readConfig } from './config-reader.js';
import {
  IMPLEMENT_COMMAND_KEY,
  implementLogPath,
  implementRunning,
  startImplement,
} from './implement-run.js';
import { usableCommand } from './usable-command.js';

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
      reason: 'no-implement-command' | 'implement-running';
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
  /** Reads `## Plot Config` keys; {@link readConfig} where absent. */
  readCfg?: BoardConfigReader;
  /** The branch the implement run briefs, or `null` for none. */
  briefBranch: (slug: string) => string | null;
}

/**
 * The first branch of the first eligible slice that is startable and unclaimed,
 * by the rule auto-dispatch counts with.
 *
 * @param pulse - a fleet reading, or `null` where there is none.
 * @param slug - the plan slug.
 * @returns the branch, or `null` where there is no reading or no eligible branch.
 */
export const briefBranchFromPulse = (pulse: FleetReading | null, slug: string): string | null =>
  pulse === null ? null : (startableBranches(pulse, slug, new Set())[0] ?? null);

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
  const implementLog = implementLogPath(opts.repoRoot, slug);
  if (implementRunning(slug)) {
    return {
      kind: 'refused',
      status: 409,
      reason: 'implement-running',
      detail: `an implement for \`${slug}\` is already running — watch it at ${implementLog}, or wait for it to finish before dispatching again`,
      log: implementLog,
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
          scriptsOf(opts).start(DISPATCH_SCRIPT, ['--max', MAX_PER_CLICK, slug], {
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
    input.briefBranch(slug),
  );
  if ('failure' in started) return { kind: 'failed', error: started.failure.detail };
  return { kind: 'started', implementLog, dispatchLog, ended };
};
