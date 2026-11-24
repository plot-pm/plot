import {
  defaultBranchFile,
  hostShell,
  prIndexFile,
  refsGit,
  refsRemoteGit,
  repairRecordFile,
  type ShellContext,
} from '@plot-pm/domain/adapters';
import { fleetdLiveness } from '@plot-pm/domain/rules/fleetd-live';
import type { FleetdHeartbeat } from '@plot-pm/domain/entities/fleetd-heartbeat';
import type { StateHome } from '@plot-pm/domain';
import type { BuildPort } from '@plot-pm/domain/ports/build';

import { refreshOnChange, runTiming, type DefaultBranchOutcome, type DefaultBranchWorld } from './default-branch-refresh.js';
import { withHostSlot, type PrState } from './pr-refresh.js';
import type { RecordReading } from './snapshot-fill.js';

/** What {@link defaultBranchWorldFor} composes the default-branch refresh from. */
export interface DefaultBranchWorldInput {
  /** Where the scripts and the repository are. */
  context: ShellContext;
  /** The state home `default-branch.json` and `repair-record.json` live under. */
  home: StateHome;
  /** The composed CI connector. */
  build: BuildPort;
  /** Whether the GitHub reads run in-process; an in-process client claims its own slot per request. */
  inProcess: boolean;
  /** The PR state whose account bound the host slot reads. */
  prState: PrState;
  /** The `Checks wait` bound in ms. */
  checksWaitMs: number;
  /** The workflow names `Default branch checks` declares. */
  checks: readonly string[];
  /** Records the beat's reading into a snapshot; absent where the process holds none. */
  record?: RecordReading;
}

/** The composed world and the remote tips its last tip read listed. */
export interface ComposedDefaultBranchWorld {
  /** The world {@link refreshOnChange} reads and writes through. */
  world: DefaultBranchWorld;
  /** Takes the `sprint/*` and default tips the last answered tip read listed, once; `null` where none answered. */
  takeTips: () => Readonly<Record<string, string>> | null;
}

/**
 * Composes the default-branch refresh's world: the remote tip read, the
 * first-parent walk, the CI connector, `default-branch.json` and the repair
 * record. fleetd and the board's PR reader compose it here, so both write the
 * reading through one writer.
 *
 * One `git ls-remote` lists the default branch's tip and every `sprint/*` tip;
 * {@link ComposedDefaultBranchWorld.takeTips} hands that listing to a caller
 * that also reads the bases.
 *
 * @param input - the context, the state home, the CI connector and the bounds.
 * @returns the world and the tip listing.
 */
export const defaultBranchWorldFor = (input: DefaultBranchWorldInput): ComposedDefaultBranchWorld => {
  const { context, home, build } = input;
  let tips: Readonly<Record<string, string>> | null = null;
  const world: DefaultBranchWorld = {
    branch: async () => {
      const base = await refsGit(context).defaultBranch();
      return base.ok ? base.value : null;
    },
    refs: {
      remoteSha: async (branch: string) => {
        const listed = await refsRemoteGit(context).remoteTips(branch);
        if (!listed.ok) {
          tips = null;
          return listed;
        }
        if (listed.value === 'unknown') {
          tips = null;
          return { ok: true as const, value: 'unknown' as const };
        }
        const sha = listed.value.tips[branch];
        tips = listed.value.tips;
        return { ok: true as const, value: sha ? { sha } : ('unknown' as const) };
      },
      firstParentLine: refsGit(context).firstParentLine,
      firstParentCommits: refsGit(context).firstParentCommits,
    },
    build,
    store: defaultBranchFile(home),
    repair: repairRecordFile(home),
    // The host-slot bound is GitHub's account budget; other systems call direct.
    slot: <T,>(call: () => Promise<T>): Promise<T> =>
      build.system() === 'github-actions' && !input.inProcess ? withHostSlot(input.prState, call) : call(),
    now: () => Date.now(),
    ...(input.record === undefined ? {} : { record: input.record }),
    checksWaitMs: input.checksWaitMs,
    timing: runTiming(),
    checks: input.checks,
  };
  return {
    world,
    takeTips: () => {
      const taken = tips;
      tips = null;
      return taken;
    },
  };
};

/**
 * The key {@link refreshOnChange} compares to tell whether the default
 * branch's remote tip may have moved: the local mirror's `origin/<branch>` and
 * the PR index's newest `mergedAt`, both read from files.
 *
 * @param context - where the scripts and the repository are.
 * @returns the key for a branch, or `null` where it cannot be read.
 */
export const tipMovedFor = (context: ShellContext) => async (branch: string): Promise<string | null> => {
  const mirror = await refsGit(context).resolve(`origin/${branch}`);
  const backend = await hostShell(context).backend();
  if (!mirror.ok || !backend.ok) return null;
  const held = await prIndexFile({ cwd: context.repoRoot }).read(backend.value);
  if (!held.ok || held.value === null) return null;
  const merged = held.value.rows.map((row) => row.mergedAt ?? '').sort().at(-1) ?? '';
  return `${mirror.value} ${merged}`;
};

/** What one {@link readerMainPass} reads before it refreshes. */
export interface ReaderMainGate {
  /** fleetd's heartbeat file as read, or `null` where there is none. */
  fleetd: () => FleetdHeartbeat | null;
  /** Whether this process holds the reader lock for its connector. */
  holdsLock: () => Promise<boolean>;
  /** Epoch ms. */
  now: () => number;
}

/**
 * Builds the board PR reader's default-branch pass: one {@link refreshOnChange}
 * refresh, run only while no fleetd heartbeat reads `live` and this process
 * holds the reader lock. fleetd writes `default-branch.json` on every PR beat
 * while it runs, so a live heartbeat leaves the file to fleetd and the reader
 * writes nothing.
 *
 * @param refresh - the refresh, built by {@link refreshOnChange}.
 * @param gate - the fleetd heartbeat, the lock holder and the clock.
 * @returns one pass per call: the refresh's outcome, or `'yielded'` where the gate holds it.
 */
export const readerMainPass = (
  refresh: () => Promise<DefaultBranchOutcome>,
  gate: ReaderMainGate,
): (() => Promise<DefaultBranchOutcome | 'yielded'>) => async () => {
  if (fleetdLiveness(gate.fleetd(), gate.now()) === 'live') return 'yielded';
  if (!(await gate.holdsLock())) return 'yielded';
  return refresh();
};
