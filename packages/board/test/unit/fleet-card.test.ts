import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fleetCard } from '@plot-pm/domain/rules/fleet-card';
import type { AgentRow, Slice } from '../../src/contract/schema.js';
import { deliveryMapping, type RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';
import { placeMapping } from '../../src/app/lib/agent-rows/delivery-view.js';
import { deliveryHeader, placeDelivery } from '@plot-pm/domain';
import { DeliveryHeader } from '../../src/app/components/DeliveryHeader.js';
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

describe('the header Fleet group counts what the Fleet section counts', () => {
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

describe('the Fleet section owns the only switches', () => {
  it('renders the writable switches with the Fleet body selectors and the stepper buttons', () => {
    expect(renderToStaticMarkup(createElement(AutoDispatchSwitch, { value: true }))).toMatch(/data-fleet-auto-dispatch="true" checked=""/);
    const verify = renderToStaticMarkup(createElement(AutoSwitch, { name: 'autoVerify', value: true }));
    expect(verify).toContain('data-fleet-auto-switch="autoVerify"');
    expect(verify).not.toContain('disabled');
    const stepper = renderToStaticMarkup(createElement(ParallelAgentsStepper, { value: 7 }));
    expect(stepper).toContain('aria-valuenow="7"');
    expect(stepper).toContain('data-fleet-parallel-increment');
    expect(stepper).toContain('data-fleet-parallel-decrement');
  });

  it('leaves no read-only copy in the header', () => {
    const html = renderToStaticMarkup(createElement(DeliveryHeader, {
      header: deliveryHeader({
        you: { counts: [], ages: [], releases: [], ticketNote: null }, work: { groups: [], ages: [] }, unplaced: [],
        agents: [{ group: 'working' }], supervisor: { state: 'up', label: 'fleet running', shown: false },
        switches: { dispatch: true, review: false, verify: true, design: false }, parallelAgents: 4, machine: null, hostAnswer: 'answered',
      }),
      release: null,
      onJump: () => {},
    }));
    expect(html).not.toMatch(/data-fleet-card|<input|role="spinbutton"/);
  });
});
