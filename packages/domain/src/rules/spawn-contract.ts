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
