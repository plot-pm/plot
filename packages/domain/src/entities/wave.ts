import { z } from 'zod';

/** A reference to one slice: the plan it belongs to, its name, its one branch. */
export interface SliceRef {
  plan: string;
  name: string;
  branch: string;
}

/**
 * What the fleet lands together — slices drawn from several plans, assembled at
 * dispatch and persisted nowhere.
 *
 * Has no constructor: nothing forms one today. `plot-dispatch.sh` requires a
 * plan slug and orders within that plan, so no component sees eligible slices
 * across plans. A type with no way to build one is the honest shape for an
 * entity with no source of truth.
 *
 * See `DESIGN-slice.md` for why this name is free: the per-plan entity was
 * renamed to Slice on 2026-08-28.
 */
export interface Wave {
  slices: readonly SliceRef[];
  /** The concurrency ceiling this wave was bounded by. */
  parallelAgents: number;
}

/**
 * How a wave's size may be bounded — `agents` by what can run at once,
 * `landable` by what can merge without colliding. Which wins is open.
 */
export const WaveBoundSchema = z.enum(['agents', 'landable']);
export type WaveBound = z.infer<typeof WaveBoundSchema>;

/**
 * Whether a slice reference names a branch at all.
 *
 * @param slice - the reference to test.
 * @returns true when plan, name and branch are all non-empty.
 */
export const isSliced = (slice: SliceRef): boolean =>
  slice.plan !== '' && slice.name !== '' && slice.branch !== '';

/**
 * The plans a set of slices spans.
 *
 * @param slices - the slices to read.
 * @returns each plan slug once, in the order first named; empty entries dropped.
 */
export const plansSpanned = (slices: readonly SliceRef[]): string[] => [
  ...new Set(slices.map((slice) => slice.plan).filter((plan) => plan !== '')),
];
