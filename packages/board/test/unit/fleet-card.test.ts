import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fleetCard } from '@plot-pm/domain/rules/fleet-card';
import type { AgentRow, Slice } from '../../src/contract/schema.js';
import { deliveryMapping, type RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';
import { placeMapping } from '../../src/app/lib/agent-rows/delivery-view.js';
import { placeDelivery } from '@plot-pm/domain';
import { FleetCard } from '../../src/app/components/FleetCard.js';
import { AutoDispatchSwitch, AutoSwitch, ParallelAgentsStepper } from '../../src/app/components/FleetControls.js';

const row = (over: Record<string, unknown>): AgentRow => ({
  branch: '', plan: '', wave: '', kind: 'branch', phase: 'Development', state: 'wip',
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

const mapping = (agents: RegistryAgent[], releases?: string[]) => deliveryMapping({
  rows: [row({ branch: 'feature/a', plan: 'p', wave: 'A' })],
  slices: ['A', 'B'].map(slice), agents, drafts: [], reader: { hostUser: 'me' }, mode: 'all',
  config: { autoReview: true, correctionBudget: 2 },
  ...(releases ? { releases, sprints: [] } : {}),
} as Parameters<typeof deliveryMapping>[0]);

describe('the fleet card counts what the Fleet header counts', () => {
  const agents = [
    agent({ session: 'x', branch: 'feature/a' }),
    agent({ session: 'y', branch: '' }),
    agent({ session: 'z', branch: '', state: 'exited' }),
  ];
  for (const releases of [undefined, ['2.99.0']]) {
    it(`for the same payload${releases ? ' with a sprint filter on' : ''}`, () => {
      const m = mapping(agents, releases);
      const placement = placeDelivery(m.readings, m.input);
      const card = fleetCard(placement.agents);
      const fleet = placeMapping(m, []).sections.find((s) => s.key === 'fleet')!;
      const header = Object.fromEntries(fleet.summary.map((c) => [c.key, c.count]));
      expect({ free: card.free, working: card.working, blocked: card.blocked }).toEqual(header);
      expect(card.free + card.working + card.blocked).toBeGreaterThan(0);
    });
  }
});

describe('the card switches are read-only', () => {
  it('renders disabled checkboxes with the Fleet body’s values and no stepper buttons', () => {
    const html = renderToStaticMarkup(createElement(FleetCard, {
      agents: [{ group: 'working' }],
      switches: { autoDispatch: true, autoReview: false, autoVerify: true, autoDesign: false, parallelAgents: 4 },
      onJump: () => {},
    }));
    expect(html).toContain('data-fleet-card="working"');
    expect(html).toContain('data-fleet-card-link');
    const boxes = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
    expect(boxes).toHaveLength(4);
    for (const b of boxes) expect(b).toContain('disabled');
    expect(boxes.map((b) => b.includes('checked'))).toEqual([true, false, true, false]);
    expect(html).toContain('aria-valuenow="4"');
    expect(html).not.toContain('data-fleet-parallel-increment');
    expect(html).not.toContain('data-fleet-parallel-decrement');
  });

  it('shows the same value as the writable switch for one payload', () => {
    const rw = renderToStaticMarkup(createElement(AutoSwitch, { name: 'autoVerify', value: true }));
    const ro = renderToStaticMarkup(createElement(AutoSwitch, { name: 'autoVerify', value: true, readOnly: true }));
    expect(rw.includes('checked')).toBe(ro.includes('checked'));
    expect(renderToStaticMarkup(createElement(AutoDispatchSwitch, { value: false, readOnly: true }))).not.toContain('checked');
    expect(renderToStaticMarkup(createElement(ParallelAgentsStepper, { value: 7, readOnly: true }))).toContain('aria-valuenow="7"');
  });

  it('leaves the Fleet body’s selectors on the writable components only', () => {
    expect(renderToStaticMarkup(createElement(AutoDispatchSwitch, { value: true }))).toContain('data-fleet-auto-dispatch');
    expect(renderToStaticMarkup(createElement(AutoDispatchSwitch, { value: true, readOnly: true }))).not.toContain('data-fleet-auto-dispatch=');
  });
});
