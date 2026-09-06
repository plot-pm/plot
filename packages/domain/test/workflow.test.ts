import { describe, expect, it } from 'vitest';

import type { Story } from '../src/entities/story.js';
import {
  BOARD_PHASES,
  DevelopmentWorkflow,
  PHASE_LEADERSHIP,
  phaseOrder,
  type Phase,
} from '../src/entities/workflow.js';
import { storyPhase, toBoardPhase } from '../src/rules/phase.js';
import {
  approvable,
  deliverable,
  releasable,
  type PlanState,
  type TransitionPlan,
} from '../src/transitions/plan.js';
import { STORY_LIFECYCLE, storyStatusSettable } from '../src/transitions/story.js';

/** A plan in the state a test needs, with everything else valid. */
const planIn = (phase: PlanState): TransitionPlan => ({
  slug: 'the-workflow-owns-the-word-phase',
  phase,
  review: 'pr',
  approvedRecord: phase === 'draft' || phase === 'design' ? '' : '2026-09-04, Jan Wloka',
  deliveredRecord: phase === 'delivered' || phase === 'released' ? '2026-09-05, Jan Wloka' : '',
  releasedRecord: phase === 'released' ? '2026-09-06, v1.0.0' : '',
});

/** A story in the status a test needs, with everything else valid. */
const storyIn = (status: Story['status']): Story => ({
  slug: 'the-domain-knows-what-plot-knows',
  title: 'The domain knows what Plot knows',
  status,
  path: 'the-domain-knows-what-plot-knows/STORY-the-domain-knows-what-plot-knows.md',
  created: '2026-09-01',
  updated: '2026-09-06',
  author: 'jwloka',
  archived: null,
});

/** The plan states the workflow knows, which is what the mapping is total over. */
const MAPPED_PLAN_STATES: readonly PlanState[] = [
  'draft', 'design', 'approved', 'delivered', 'released',
];

describe('DevelopmentWorkflow — the phases, their order, their leaders', () => {
  it('holds the five phases in the order work passes through them', () => {
    expect(DevelopmentWorkflow.phases).toEqual([
      'Discovery', 'Design', 'Development', 'Testing', 'Released',
    ]);
  });

  it('places every phase, counting from zero and never repeating a position', () => {
    const positions = BOARD_PHASES.map((phase) => phaseOrder(phase));
    expect(positions).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(positions).size).toBe(BOARD_PHASES.length);
  });

  it('names who leads every phase, with a symbol AND a word', () => {
    // Colour may only repeat these: roughly one man in twelve distinguishes red
    // from green poorly, and the board turns up in greyscale screenshots.
    for (const phase of BOARD_PHASES) {
      expect(PHASE_LEADERSHIP[phase].icon).toBeTruthy();
      expect(PHASE_LEADERSHIP[phase].who).toBeTruthy();
    }
    expect(PHASE_LEADERSHIP.Development.who).toBe('agent-led');
    expect(PHASE_LEADERSHIP.Discovery.who).toBe('human-led');
    expect(PHASE_LEADERSHIP.Testing.who).toBe('human-led');
  });

  it('exposes the same phases and leaders through the workflow as through the names', () => {
    // One declaration, reached two ways — not two lists that agree today.
    expect(DevelopmentWorkflow.phases).toBe(BOARD_PHASES);
    expect(DevelopmentWorkflow.leadership).toBe(PHASE_LEADERSHIP);
    expect(DevelopmentWorkflow.order('Testing')).toBe(phaseOrder('Testing'));
  });
});

describe('a state maps to exactly one phase', () => {
  it('gives every plan state the workflow knows exactly one phase', () => {
    for (const state of MAPPED_PLAN_STATES) {
      const phase = toBoardPhase(state);
      expect(phase).not.toBeNull();
      expect(BOARD_PHASES).toContain(phase);
    }
  });

  it('gives every story status exactly one phase, with no status unmapped', () => {
    for (const status of STORY_LIFECYCLE) {
      expect(BOARD_PHASES).toContain(storyPhase(status));
    }
  });

  it('answers null for a plan state the workflow does not know', () => {
    // The states no phase holds: a verdict and a relation, not places in the
    // workflow. There is no such case for a story, whose statuses are a closed
    // enum with no unmapped member.
    expect(toBoardPhase('rejected')).toBeNull();
    expect(toBoardPhase('superseded')).toBeNull();
    expect(toBoardPhase('none')).toBeNull();
  });
});

describe('the phase order agrees with the state transitions', () => {
  // THE ONE PROPERTY A DERIVED ORDER CAN GET WRONG. The transitions gate the
  // work and the phases carry their sequence as data; this asserts the two
  // agree rather than adding a second enforcer that could disagree.
  //
  // The edges are read from the transitions THEMSELVES rather than transcribed,
  // so a transition that gains or loses an edge moves this test with it.

  /** Whether a plan in `from` may move to `to`, asked of the transitions. */
  const planEdge = (from: PlanState, to: PlanState): boolean => {
    const plan = planIn(from);
    if (to === 'approved') return approvable(plan);
    if (to === 'delivered') return deliverable(plan);
    if (to === 'released') return releasable(plan);
    return false;
  };

  it('never sends a plan state backwards through the phases', () => {
    const edges: string[] = [];
    for (const from of MAPPED_PLAN_STATES) {
      for (const to of MAPPED_PLAN_STATES) {
        if (from === to || !planEdge(from, to)) continue;
        const before = toBoardPhase(from);
        const after = toBoardPhase(to);
        expect(before).not.toBeNull();
        expect(after).not.toBeNull();
        edges.push(`${from} -> ${to}`);
        expect(phaseOrder(after as Phase)).toBeGreaterThanOrEqual(phaseOrder(before as Phase));
      }
    }
    // The loop must have had edges to check: a transition set that refused
    // everything would pass vacuously.
    expect(edges.length).toBeGreaterThan(0);
  });

  it('never sends a story status backwards through the phases', () => {
    const edges: string[] = [];
    for (const from of STORY_LIFECYCLE) {
      for (const to of STORY_LIFECYCLE) {
        if (from === to || !storyStatusSettable(storyIn(from), to)) continue;
        edges.push(`${from} -> ${to}`);
        expect(phaseOrder(storyPhase(to))).toBeGreaterThanOrEqual(phaseOrder(storyPhase(from)));
      }
    }
    expect(edges.length).toBeGreaterThan(0);
  });

  it('reads a pause as holding its phase rather than returning to an earlier one', () => {
    // `active -> paused -> active` is the one round trip in either lifecycle.
    // Pausing stops work; it does not undo it, so the phase does not move.
    expect(storyPhase('paused')).toBe(storyPhase('active'));
  });
});
