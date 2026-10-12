import type { StoryStatus } from '../entities/story.js';
import { StoryStatusSchema } from '../entities/story.js';
import type { WorkflowName } from '../entities/workflow.js';

/** A plan state a phase can hold. `rejected` and `superseded` are absent: no phase holds them. */
export type DeclarablePlanState = 'draft' | 'design' | 'approved' | 'delivered' | 'released';

const DECLARABLE_PLAN_STATES: readonly DeclarablePlanState[] = [
  'draft', 'design', 'approved', 'delivered', 'released',
];

/** The plan states that name the `withdrawn` terminal status, which no phase holds. */
const WITHDRAWN_STATES: readonly string[] = ['rejected', 'superseded'];

/** One declared phase: its name and the plan states and story statuses it holds. */
export interface PhaseEntry {
  name: string;
  plan: readonly DeclarablePlanState[];
  /** `story:*` is expanded to every status at parse time. */
  story: readonly StoryStatus[];
}

/** An ordered list of phases. The order is the declared order. */
export type PhaseMap = readonly PhaseEntry[];

/** Why a `Workflow phases` value was refused, and which entry. */
export interface PhaseMapRefusal {
  /** The offending entry as written, trimmed; empty when the whole value is at fault. */
  entry: string;
  reason: string;
}

export type PhaseMapResult =
  | { ok: true; map: PhaseMap }
  | { ok: false; refusal: PhaseMapRefusal };

/** The map a repository gets when it declares no `Workflow phases` key. */
export const DEFAULT_PHASE_MAP: PhaseMap = [
  { name: 'Discovery', plan: [], story: [...StoryStatusSchema.options] },
  { name: 'Design', plan: ['draft', 'design'], story: [] },
  { name: 'Development', plan: ['approved'], story: [] },
  { name: 'Testing', plan: ['delivered'], story: [] },
  { name: 'Released', plan: ['released'], story: [] },
];

const refuse = (entry: string, reason: string): PhaseMapResult => ({ ok: false, refusal: { entry, reason } });

/**
 * Reads the `Workflow phases` value.
 *
 * Entries are separated by `;` and each is `<name> = <member>, <member>, …`. A member is
 * `plan:<state>` or `story:<status>`; `story:*` stands for every status. Blank entries are
 * ignored. Any other malformed entry is refused, naming the entry and the reason.
 *
 * @param value - the config value.
 * @returns the phases in declared order, or the first refusal.
 */
export const parsePhaseMap = (value: string): PhaseMapResult => {
  const entries = value.split(';').map((raw) => raw.trim()).filter((raw) => raw !== '');
  if (entries.length === 0) return refuse('', 'no phase is declared');

  const planOwner = new Map<string, string>();
  const storyOwner = new Map<string, string>();
  const names = new Set<string>();
  const map: PhaseEntry[] = [];

  for (const raw of entries) {
    const at = raw.indexOf('=');
    if (at < 0) return refuse(raw, 'missing "=" between the phase name and its members');
    const name = raw.slice(0, at).trim();
    if (!name) return refuse(raw, 'the phase name is empty');
    if (names.has(name)) return refuse(raw, `the phase "${name}" is declared twice`);
    names.add(name);
    const members = raw.slice(at + 1).split(',').map((member) => member.trim());
    if (members.every((member) => member === '')) return refuse(raw, 'the phase holds no member');

    const plan: DeclarablePlanState[] = [];
    const story: StoryStatus[] = [];
    for (const member of members) {
      if (member === '') return refuse(raw, 'a member is empty');
      const colon = member.indexOf(':');
      const kind = colon < 0 ? '' : member.slice(0, colon).trim();
      const word = colon < 0 ? '' : member.slice(colon + 1).trim();
      if (kind !== 'plan' && kind !== 'story') {
        return refuse(raw, `member "${member}" lacks a "plan:" or "story:" prefix`);
      }
      if (word === '') return refuse(raw, `member "${member}" names nothing after the prefix`);

      if (kind === 'plan') {
        if (WITHDRAWN_STATES.includes(word)) {
          return refuse(raw, `plan:${word} cannot be declared: it is the withdrawn status, which no phase holds`);
        }
        if (!DECLARABLE_PLAN_STATES.includes(word as DeclarablePlanState)) {
          return refuse(raw, `"${word}" is not a plan state (${DECLARABLE_PLAN_STATES.join(', ')})`);
        }
        const state = word as DeclarablePlanState;
        const owner = planOwner.get(state);
        if (owner !== undefined) return refuse(raw, `plan:${state} is already held by "${owner}"`);
        planOwner.set(state, name);
        plan.push(state);
        continue;
      }

      let statuses: readonly StoryStatus[];
      if (word === '*') {
        statuses = StoryStatusSchema.options;
      } else if ((StoryStatusSchema.options as readonly string[]).includes(word)) {
        statuses = [word as StoryStatus];
      } else {
        return refuse(raw, `"${word}" is not a story status (${StoryStatusSchema.options.join(', ')}, or *)`);
      }
      for (const status of statuses) {
        const owner = storyOwner.get(status);
        if (owner !== undefined) return refuse(raw, `story:${status} is already held by "${owner}"`);
        storyOwner.set(status, name);
        story.push(status);
      }
    }
    map.push({ name, plan, story });
  }
  return { ok: true, map };
};

/** What was read of one plan: its state word and whether every branch has landed. */
export interface PlanPhaseReadings {
  /** The plan file's state word, lowercased. */
  state: string;
  /** Whether the plan is deliverable. */
  deliverable?: boolean;
}

/**
 * The phase a plan reads in.
 *
 * A deliverable plan reads in the phase holding `plan:delivered`, and in its state's own phase
 * when no phase holds that.
 *
 * @param map - the declared phases.
 * @param readings - the plan's state and deliverability.
 * @returns the phase name, or `null` where no phase holds the state.
 */
export const phaseOfPlan = (map: PhaseMap, readings: PlanPhaseReadings): string | null => {
  const holding = (state: string): string | null =>
    map.find((entry) => (entry.plan as readonly string[]).includes(state))?.name ?? null;
  if (readings.deliverable) {
    const delivered = holding('delivered');
    if (delivered !== null) return delivered;
  }
  return holding(readings.state);
};

/**
 * The phase a story status reads in.
 *
 * @param map - the declared phases.
 * @param status - the story's status, from its frontmatter.
 * @returns the phase name, or `null` where no phase holds the status.
 */
export const phaseOfStory = (map: PhaseMap, status: StoryStatus): string | null =>
  map.find((entry) => entry.story.includes(status))?.name ?? null;

/**
 * The phases that hold at least one plan state.
 *
 * @param map - the declared phases.
 * @returns their names, in declared order.
 */
export const planPhases = (map: PhaseMap): string[] =>
  map.filter((entry) => entry.plan.length > 0).map((entry) => entry.name);

/** The lifecycle workflows and the plan states each acts on, in the order a phase performs them. */
const WORKFLOW_ACTS_ON: readonly (readonly [WorkflowName, readonly DeclarablePlanState[]])[] = [
  ['approve', ['draft', 'design']],
  ['dispatch', ['approved']],
  ['implement', ['approved']],
  ['deliver', ['approved']],
  ['release', ['delivered']],
];

/**
 * The workflows each declared phase performs.
 *
 * A workflow belongs to the first declared phase holding a state it acts on. A workflow whose
 * states no phase holds belongs to none. The fleet's workflows act on agents and desks and
 * appear in no phase.
 *
 * @param map - the declared phases.
 * @returns the workflows per phase name, every declared phase present.
 */
export const phaseWorkflows = (map: PhaseMap): Record<string, readonly WorkflowName[]> => {
  const result: Record<string, WorkflowName[]> = Object.fromEntries(map.map((entry) => [entry.name, []]));
  for (const [workflow, states] of WORKFLOW_ACTS_ON) {
    const owner = map.find((entry) => entry.plan.some((state) => states.includes(state)));
    if (owner) result[owner.name]!.push(workflow);
  }
  return result;
};
