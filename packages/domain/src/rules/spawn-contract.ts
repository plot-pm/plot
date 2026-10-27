/**
 * The number every unattended spawn carries, so a gate reading its own
 * process environment can tell a spawner that loaded older gate-reading code
 * from one that loaded the gate's own version or newer (#2728,
 * `docs/plans/2026-10-26-a-board-or-fleetd-older-than.md`).
 *
 * A board or fleetd that started before a gate's environment contract
 * changed keeps spawning unattended runs with the OLD contract. The gate
 * reads only its own process environment, so without a number to compare it
 * cannot tell a stale spawner from a correct one — it can only guess from the
 * refusal text, which is exactly what left #2725's agent unable to tell
 * whether its main-checkout refusal meant "this is a mistake" or "the process
 * that spawned you is stale."
 *
 * **THE BUMP RULE IS BINDING, NOT ADVISORY.** Any change — in this slice or a
 * future one — that adds, removes or renames an environment variable a gate
 * reads (`PLOT_UNATTENDED`, `PLOT_MAIN_CHECKOUT_WRITER`, `PLOT_BRIEF_ONLY`,
 * `PLOT_BRIEF_BRANCH`, `PLOT_SPAWN_CONTRACT`), or changes which spawn sets or
 * clears one of them, MUST raise {@link SPAWN_CONTRACT} by one in the same
 * change. `test/reconcile/spawn-contract-gate.test.mjs` enforces this: it
 * reads the gate-read variable names and their setter files fresh from the
 * tree and compares that against {@link SPAWN_CONTRACT_SHAPE}, which is keyed
 * to the *current* `SPAWN_CONTRACT` number. A mismatch fails the test, naming
 * what changed, so the shape and the number cannot drift apart silently.
 */

import type { BoardStatus } from './default-branch.js';

/** The number every unattended spawn's environment carries today. */
export const SPAWN_CONTRACT = 1;

/** The variable an unattended spawn's environment carries {@link SPAWN_CONTRACT} in. */
export const SPAWN_CONTRACT_ENV = 'PLOT_SPAWN_CONTRACT';

/**
 * The spawn contract as environment, for every fleet run on either runner —
 * modeled on `backgroundGateEnv()` (`agent-run-env.ts`), which returns a
 * small forced-value object the same way.
 *
 * @returns the one variable and its value.
 */
export const spawnContractEnv = (): Readonly<Record<string, string>> => ({
  [SPAWN_CONTRACT_ENV]: String(SPAWN_CONTRACT),
});

/** What a gate reads {@link SPAWN_CONTRACT_ENV} as. */
export type SpawnContractReading =
  | 'absent'
  | 'empty'
  | 'unreadable'
  | { readonly number: number };

/**
 * Reads {@link SPAWN_CONTRACT_ENV} out of a gate's own process environment.
 *
 * **`absent` AND `empty` ARE KEPT DISTINCT even though both currently mean
 * "no contract" in practice.** `absent` means the spawner predates the
 * contract entirely — it never set the variable. `empty` means a spawner set
 * it to `''` on purpose, which no current spawner does, but the shape exists
 * for the next spawner that might clear it deliberately rather than omit it.
 * Collapsing the two would make a future "I am deliberately contract-less"
 * spawner indistinguishable from a merely stale one.
 *
 * **`'0'` reads as `unreadable`, not as a number.** {@link SPAWN_CONTRACT}
 * starts at `1` and is a positive integer by construction, so `0` is not a
 * value any correct spawner can produce — only a positive integer is ever
 * trusted as a reading.
 *
 * @param env - the gate's own process environment.
 * @returns `absent` when unset, `empty` when set to `''`, `unreadable` when
 *   set to text that is not a positive integer, or the parsed number.
 */
export const spawnContractReading = (
  env: Readonly<Record<string, string | undefined>>,
): SpawnContractReading => {
  const value = env[SPAWN_CONTRACT_ENV];
  if (value === undefined) return 'absent';
  if (value === '') return 'empty';
  if (!/^[1-9][0-9]*$/.test(value)) return 'unreadable';
  return { number: Number(value) };
};

/**
 * One gate-read variable's setters, as of {@link SPAWN_CONTRACT}'s current
 * number — the fixture `test/reconcile/spawn-contract-gate.test.mjs` compares
 * a fresh read of the tree against.
 */
export interface SpawnContractVariableShape {
  /** The environment variable name a gate reads. */
  readonly name: string;
  /** The files that set or clear this variable, sorted. */
  readonly setters: readonly string[];
}

/**
 * The declared shape of every environment variable a Plot gate reads, keyed
 * to the `SPAWN_CONTRACT` number current when this was last updated. Raising
 * `SPAWN_CONTRACT` means updating this alongside it — the two change in the
 * same commit, never one without the other.
 */
/**
 * What a spawner (the board or fleetd) reports about its own spawn contract
 * against the gate's own number — three words only, each naming what a
 * restart would do, never suggesting one (#2728,
 * `docs/plans/2026-10-26-a-board-or-fleetd-older-than.md`).
 *
 * **`current`**: the spawner's recorded number equals the gate's.
 * **`stale`**: the numbers differ, in EITHER direction — both are always
 * carried, never collapsed to a boolean or a word like "different".
 * **`unknown`**: no recorded identity, a pid mismatch, or a gate that did not
 * answer. A missing record and an unreadable gate are indistinguishable from
 * here, by design: both mean *nothing to compare*.
 */
export type SpawnerStatusVerdict =
  | { readonly kind: 'current' }
  | { readonly kind: 'stale'; readonly spawnerNumber: number; readonly gateNumber: number }
  | { readonly kind: 'unknown' };

/**
 * One spawner's own recorded identity, as {@link FleetdStart} or the board's
 * compiled equivalent carries it — the values {@link spawnerStatus} compares
 * against a gate's answer.
 */
export interface SpawnerIdentity {
  /** The process id the record was written under. */
  readonly pid: number;
  /** The spawn contract number the record carries. */
  readonly spawnContract: number;
}

/**
 * Compares a spawner's own recorded spawn contract against a gate's answer.
 *
 * **REPORT ONLY.** This function compares two numbers and returns a word; it
 * starts, stops, kicks and reloads nothing, and nothing downstream of it may
 * either — that is the whole point of #2728's fix.
 *
 * @param identity - the spawner's own record, or `null` where none exists.
 * @param runningPid - the pid of the supervisor actually running now; a
 *   record whose `pid` does not match reads `unknown` rather than stale or
 *   current, because the record may describe a process that already exited.
 * @param gateNumber - the gate's own `--spawn-contract` answer, or `null`
 *   where the gate did not answer.
 * @returns `current`, `stale` naming both numbers, or `unknown`.
 */
export const spawnerStatus = (
  identity: SpawnerIdentity | null,
  runningPid: number,
  gateNumber: number | null,
): SpawnerStatusVerdict => {
  if (identity === null || identity.pid !== runningPid || gateNumber === null) {
    return { kind: 'unknown' };
  }
  if (identity.spawnContract === gateNumber) return { kind: 'current' };
  return { kind: 'stale', spawnerNumber: identity.spawnContract, gateNumber };
};

/**
 * Renders a {@link SpawnerStatusVerdict} as the one-line text every
 * `--status` script and the board print — the exact three shapes the brief
 * requires, so no caller formats its own variant.
 *
 * @param verdict - the comparison's result.
 * @returns `current`, `stale: spawn contract N, gate expects M`, or `unknown`.
 */
export const spawnerStatusText = (verdict: SpawnerStatusVerdict): string => {
  switch (verdict.kind) {
    case 'current':
      return 'current';
    case 'stale':
      return `stale: spawn contract ${verdict.spawnerNumber}, gate expects ${verdict.gateNumber}`;
    case 'unknown':
      return 'unknown';
  }
};

/**
 * Whether a running bundle's hash differs from the one a spawner recorded at
 * its own start.
 *
 * **EVIDENCE, NEVER THE VERDICT.** A content-hash difference is never
 * `stale` by itself — only a different `SPAWN_CONTRACT` number is. This is
 * why {@link spawnerStatus} and this function take separate inputs and
 * produce separate lines: folding them together would let a rebuild with an
 * unchanged contract number read as stale, which it is not.
 *
 * @param recordedHash - the hash the spawner wrote at its own start.
 * @param runningHash - a fresh hash of the same path, read now.
 * @returns true where they differ; false where they match or either is absent.
 */
export const bundleDriftDetected = (recordedHash: string | null, runningHash: string | null): boolean =>
  recordedHash !== null && runningHash !== null && recordedHash !== runningHash;

/**
 * Renders the bundle-drift evidence line, separate from
 * {@link spawnerStatusText} — its own tone, never folded into
 * stale/current/unknown.
 *
 * @param bundlePath - the path the spawner recorded its hash against.
 * @returns the evidence line.
 */
export const bundleDriftText = (bundlePath: string): string => `bundle differs from ${bundlePath} (evidence, not the verdict)`;

/**
 * The board-status panel entry for a stale spawn contract — null for
 * `current` and `unknown`, the same absent-when-healthy contract
 * `checkoutHealthStatus` and `defaultBranchStatus` follow, so an unreadable
 * gate or a current board shows nothing here.
 *
 * @param verdict - the comparison's result.
 * @returns a rose status entry while stale; null for `current` or `unknown`.
 */
export const spawnerStatusEntry = (verdict: SpawnerStatusVerdict): BoardStatus | null =>
  verdict.kind === 'stale'
    ? {
        key: 'spawn-contract-stale',
        severity: 20,
        tone: 'rose',
        text: spawnerStatusText(verdict),
      }
    : null;

/**
 * The board-status panel entry for the bundle-drift evidence line — its own
 * entry, never folded into {@link spawnerStatusEntry}, so a rebuild with an
 * unchanged contract number cannot read as the stale verdict.
 *
 * @param drifted - whether the running bundle's hash differs from the one
 *   recorded at start.
 * @param bundlePath - the path the drift was measured against.
 * @returns an amber status entry while drifted; null otherwise.
 */
export const bundleDriftEntry = (drifted: boolean, bundlePath: string): BoardStatus | null =>
  drifted
    ? {
        key: 'spawn-contract-bundle-drift',
        severity: 10,
        tone: 'amber',
        text: bundleDriftText(bundlePath),
      }
    : null;

export const SPAWN_CONTRACT_SHAPE: readonly SpawnContractVariableShape[] = [
  {
    name: 'PLOT_BRIEF_BRANCH',
    setters: [
      'packages/fleet/src/shared/implement-run.ts',
      'skills/plot/scripts/plot-dispatch.sh',
    ],
  },
  {
    name: 'PLOT_BRIEF_ONLY',
    setters: ['packages/fleet/src/shared/implement-run.ts'],
  },
  {
    name: 'PLOT_MAIN_CHECKOUT_WRITER',
    setters: [
      'packages/board/src/server/deliver.ts',
      'packages/board/src/server/reslice.ts',
      'packages/board/src/server/story.ts',
      'packages/fleet/src/shared/auto-deliver.ts',
      'packages/fleet/src/shared/brief-ask.ts',
      'packages/fleet/src/shared/continuation.ts',
      'skills/plot/scripts/plot-dispatch.sh',
    ],
  },
  {
    name: 'PLOT_UNATTENDED',
    setters: [
      'packages/board/src/server/deliver.ts',
      'packages/board/src/server/idea.ts',
      'packages/board/src/server/interrogate.ts',
      'packages/board/src/server/reslice.ts',
      'packages/board/src/server/story.ts',
      'packages/fleet/src/shared/auto-deliver.ts',
      'packages/fleet/src/shared/auto-design.ts',
      'packages/fleet/src/shared/auto-verify.ts',
      'packages/fleet/src/shared/implement-run.ts',
      'skills/plot/scripts/plot-dispatch.sh',
    ],
  },
] as const;
