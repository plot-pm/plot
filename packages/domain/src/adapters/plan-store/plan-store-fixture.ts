import type { PlanRecord, PlanStore } from '../../ports/plan-store.js';
import { answered, failed, type PortResult } from '../../port-result.js';

/** The estate a fixture `PlanStore` answers from. */
export interface PlanStoreFixture {
  /** The plans, in the order `listPlans` should report their paths. */
  plans?: readonly PlanRecord[];
  /** The `## Plot Config` keys this estate declares. */
  config?: Readonly<Record<string, string>>;
}

/**
 * Fills a partial plan out to a whole `PlanRecord`.
 *
 * Every absent field takes its empty value, which is the same contract
 * `planStoreShell` applies to a parser line that omitted a key. A fixture that
 * had to state all twenty fields to vary one would be rewritten as a helper by
 * its first caller.
 *
 * @param over - the fields the fixture states.
 * @returns a complete record.
 */
export const planRecord = (over: Partial<PlanRecord> = {}): PlanRecord => ({
  file: '',
  format: 'canonical',
  phase: '',
  phaseRaw: '',
  type: '',
  title: '',
  sprint: '',
  story: '',
  assignee: '',
  branches: [],
  prs: [],
  slices: [],
  review: '',
  impl: '',
  approvedRaw: '',
  deliveredRaw: '',
  releasedRaw: '',
  startedRaw: [],
  ...over,
});

/**
 * Answers plan questions from fixtures instead of `plot-plan-meta.sh`.
 *
 * An adapter like any other: the same port, a different world behind it. It is
 * on the DRIVEN side deliberately — nothing above the ports is told a mock
 * exists, so a controller written against `PlanStore` serves fixtures or the
 * real estate depending only on which adapter was constructed.
 *
 * It reads no environment. The estate is the argument, which is what lets a
 * caller hold exactly the estate it built regardless of what any global says.
 *
 * @param fixture - the plans and config keys this estate holds.
 * @returns a `PlanStore` backed by that fixture.
 */
export const planStoreFixture = (fixture: PlanStoreFixture = {}): PlanStore => {
  const plans = fixture.plans ?? [];
  const config = fixture.config ?? {};
  const byFile = new Map(plans.map((plan) => [plan.file, plan]));

  const readPlans = async (
    files: readonly string[],
  ): Promise<PortResult<readonly PlanRecord[]>> =>
    answered(files.map((file) => byFile.get(file)).filter((plan) => plan !== undefined));

  return {
    readPlans,

    readPlan: async (file) => {
      const plan = byFile.get(file);
      return plan === undefined ? failed<PlanRecord>() : answered(plan);
    },

    listPlans: async () => answered(plans.map((plan) => plan.file)),

    config: async (key, fallback) => answered(config[key] ?? fallback),
  };
};
