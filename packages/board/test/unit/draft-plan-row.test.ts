import { describe, it, expect } from 'vitest';
import { draftPlanOf, type PlanOwnerFields } from '../../src/server/board.js';
import { draftPlanRows, draftRoundsText } from '../../src/app/lib/agent-rows/working-agents.js';
import { PlanMetaSchema, type AgentRow } from '../../src/contract/schema.js';

// No owner named — the common case these fixtures exercise; `planEstate` tests
// below cover a Draft plan whose fields resolve to someone.
const NO_OWNER: PlanOwnerFields = { assignee: '', author: '', approver: '' };

// A DRAFT PLAN ASKS FOR A DECISION.
//
// Every row on the Agents tab derives from a branch, and a Draft plan has none:
// branches are cut at dispatch, after approval. Measured 2026-09-26, `/api/fleet`
// served 28 rows and 0 Draft plans while a plan was being drafted. These are the
// four Done-when lines of `a-draft-plan-asks-for-a-decision`, each from the
// functions that decide them: `draftPlanOf` picks the phase on the server, and
// `draftPlanRows` drops a plan a branch row already carries.

const PATH = 'docs/plans/2026-09-26-zucchini-glut.md';

const meta = (phase: string, extra: Record<string, unknown> = {}) =>
  PlanMetaSchema.parse({ file: `/repo/${PATH}`, format: 'canonical', phase, title: 'Zucchini glut', ...extra });

// `draftPlanRows` reads only `plan` off a row, so the fixture carries only that.
const branchRow = (plan: string): AgentRow =>
  ({ repo: 'repo', branch: 'feature/zucchini-glut', plan, group: 'waiting-on-you' }) as AgentRow;

describe('a Draft plan with no branch row', () => {
  it('becomes one WAITING ON YOU row naming its rounds', () => {
    const draft = draftPlanOf(meta('draft', { rounds: 2 }), PATH, NO_OWNER);
    expect(draft).toEqual({
      plan: 'zucchini-glut',
      planFile: '2026-09-26-zucchini-glut.md',
      title: 'Zucchini glut',
      issues: [],
      assignee: '',
      author: '',
      approver: '',
      rounds: 2,
    });
    const rows = draftPlanRows([draft!], []);
    expect(rows).toEqual([draft]);
    expect(draftRoundsText(rows[0].rounds)).toBe('2 rounds');
  });

  it('is not emitted where a branch row already belongs to the plan', () => {
    // `Impl: same branch` puts a Draft plan on its work branch, and the
    // classifier's `draft` arm already places that row in WAITING ON YOU. A
    // source filtering on phase alone would name the plan twice.
    const draft = draftPlanOf(meta('draft', { rounds: 1 }), PATH, NO_OWNER)!;
    expect(draftPlanRows([draft], [branchRow('zucchini-glut')])).toEqual([]);
    // Control: a row belonging to ANOTHER plan does not suppress it.
    expect(draftPlanRows([draft], [branchRow('other-plan')])).toEqual([draft]);
  });

  it('a plan-less row does not suppress anything', () => {
    // An unplanned PR row carries `plan: ''`; the empty string names no plan.
    const draft = { plan: '', planFile: '', title: '' };
    expect(draftPlanRows([draft], [branchRow('')])).toEqual([draft]);
  });
});

describe('a plan past Draft', () => {
  // "No branch row" is not the trigger: a Released plan drains from the pulse
  // and has no row either, so a source keyed on the row set alone would list it.
  for (const phase of ['approved', 'delivered', 'released']) {
    it(`produces no row at ${phase}`, () => {
      expect(draftPlanOf(meta(phase, { rounds: 3 }), PATH, NO_OWNER)).toBeNull();
    });
  }
});

describe('rounds is reported, never defaulted', () => {
  it('no Rounds: field and Rounds: 0 stay two different answers', () => {
    const absent = draftPlanOf(meta('draft'), PATH, NO_OWNER)!;
    const zero = draftPlanOf(meta('draft', { rounds: 0 }), PATH, NO_OWNER)!;
    expect('rounds' in absent).toBe(false);
    expect(zero.rounds).toBe(0);
    expect(draftRoundsText(absent.rounds)).toBe('not interrogated');
    expect(draftRoundsText(zero.rounds)).toBe('0 rounds');
    expect(draftRoundsText(1)).toBe('1 round');
  });
});

describe('a Draft plan row carries its owner fields', () => {
  it('passes assignee, author and approver through from the caller', () => {
    const owner: PlanOwnerFields = { assignee: 'jwloka', author: 'eins78', approver: 'Jan Wloka' };
    const draft = draftPlanOf(meta('draft'), PATH, owner)!;
    expect(draft.assignee).toBe('jwloka');
    expect(draft.author).toBe('eins78');
    expect(draft.approver).toBe('Jan Wloka');
  });
});
