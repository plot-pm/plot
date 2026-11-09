import { describe, it, expect } from 'vitest';
import { DELIVERY_LAYOUT } from '@plot-pm/domain';
import type { AgentRow, Slice } from '../../src/contract/schema.js';
import { deliveryMapping, type RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';
import { machineLine, placeMapping } from '../../src/app/lib/agent-rows/delivery-view.js';

const row = (over: Record<string, unknown>): AgentRow => ({
  branch: '', plan: '', wave: '', kind: 'branch', phase: 'approved', state: 'wip',
  group: 'working', pr: null, question: null, blockedBy: null,
  assignee: '', author: '', approver: '', ...over,
}) as unknown as AgentRow;

const slice = (name: string): Slice => ({
  plan: 'p', name, branches: [], verdict: 'eligible', section: 'building', complete: false,
  planSliceCount: 1,
}) as unknown as Slice;

const agent = (over: Record<string, unknown>): RegistryAgent => ({
  session: 's', branch: '', state: 'running', pid: 1, ...over,
}) as unknown as RegistryAgent;

const view = (rows: AgentRow[], agents: RegistryAgent[] = []) =>
  placeMapping(deliveryMapping({
    rows, slices: ['A', 'B'].map(slice), agents, drafts: [], reader: { hostUser: 'me' }, mode: 'all',
    config: { autoReview: true, correctionBudget: 2 },
  }));

describe('delivery view order', () => {
  it('renders the sections and groups in exactly DELIVERY_LAYOUT order', () => {
    const v = view([]);
    expect(v.sections.map((s) => s.key)).toEqual(DELIVERY_LAYOUT.map((l) => l.section));
    for (const [i, layout] of DELIVERY_LAYOUT.entries()) {
      expect(v.sections[i]!.groups.map((g) => g.key)).toEqual([...layout.groups]);
    }
  });

  it('shows an item once and links its agent both ways', () => {
    const v = view(
      [row({ branch: 'feature/a', plan: 'p', wave: 'A' })],
      [agent({ session: 'x', branch: 'feature/a' })],
    );
    const items = v.sections.flatMap((s) => s.groups.flatMap((g) => g.items));
    const agents = v.sections.flatMap((s) => s.groups.flatMap((g) => g.agents));
    expect(items).toHaveLength(1);
    expect(agents).toHaveLength(1);
    expect(items[0]!.links.map((l) => l.anchor)).toEqual([agents[0]!.anchor]);
    expect(agents[0]!.links.map((l) => l.anchor)).toEqual([items[0]!.anchor]);
  });

  it('names a section hint without a forecast', () => {
    for (const s of view([]).sections) expect(s.hint).not.toContain('will finish');
  });
});

describe('machineLine', () => {
  it('says no process to wait on for rows with none', () => {
    expect(machineLine([row({})])).toBe('no process to wait on');
  });

  it('counts the processes the rows carry', () => {
    expect(machineLine([row({ processes: [{}, {}] })])).toBe('2 processes running');
    expect(machineLine([row({ processes: [{}] })])).toBe('1 process running');
  });
});
