import { describe, it, expect } from 'vitest';
import { parsePersonDirectory, type MineMode, type Reader } from '@plot-pm/domain';
import { deliveryHeaderOf, type DeliveryHeaderReadings } from '../../src/app/lib/agent-rows/delivery-header.js';
import { agentsForReader, type PlanOwners } from '../../src/app/lib/agent-rows/mine-filter.js';
import type { DeliveryMapInput, RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';
import type { AgentRow } from '../../src/contract/schema.js';

const me: Reader = { hostUser: 'jwloka', directory: parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht') };
const MODES: readonly MineMode[] = ['all', 'mine-and-unknown', 'mine'];
const owners = (assignee: string): PlanOwners => ({ assignee, author: '', approver: '' });

const branchRow = (plan: string, branch: string, prAuthor: string, assignee: string): AgentRow => ({
  branch, plan, wave: branch, kind: 'branch', phase: 'Development', planState: 'approved', state: 'wip', group: 'working',
  worker: 'running', question: null, blockedBy: null,
  pr: { number: branch.length, author: prAuthor, state: 'pending', open: true, ciChecks: 'pending' },
  ...owners(assignee),
}) as unknown as AgentRow;

const agentOn = (session: string, branch: string, state: string): RegistryAgent =>
  ({ session, branch, state, identity: 'declared', pid: 1 }) as unknown as RegistryAgent;

const rows = [
  branchRow('ours', 'feature/ours', 'jwloka', 'jwloka'),
  branchRow('theirs', 'feature/theirs', 'eins78', 'eins78'),
];
// `agentsForReader` drops this agent in `mine-and-unknown` and `mine`: it runs
// elsewhere, on a plan of another person.
const dropped = agentOn('t', 'feature/theirs', 'elsewhere');
const agents = [agentOn('o', 'feature/ours', 'running'), dropped];

const readings = (mode: MineMode, over: Partial<DeliveryHeaderReadings> = {}): DeliveryHeaderReadings => ({
  mappingInput: {
    rows, slices: [], agents: [], drafts: [], reader: me, mode, config: { autoReview: true, correctionBudget: 2 },
  } as DeliveryMapInput,
  fleet: {
    agents,
    supervisor: { state: 'up', prominence: 'quiet', shown: false, label: 'fleet running', detail: '' },
    fleetControls: { autoDispatch: true, parallelAgents: 3 },
    autoReview: true,
    machine: null,
    prAgeSeconds: 10, prError: null,
    issueAnswer: 'answered', issueError: null, prNextInSeconds: null, issueAgeSeconds: null,
  } as unknown as DeliveryHeaderReadings['fleet'],
  reader: me,
  phaseMap: undefined,
  stories: [],
  cards: [],
  ...over,
});

describe('deliveryHeaderOf ignores Mine', () => {
  it('holds an agent that agentsForReader drops, so the fixture bites', () => {
    const byBranch = new Map(rows.map((r) => [r.branch, owners(r.assignee as string)]));
    expect(agentsForReader(agents, me, 'mine-and-unknown', byBranch)).not.toContain(dropped);
    expect(agentsForReader(agents, me, 'mine', byBranch)).not.toContain(dropped);
  });

  it('gives equal facts in every Mine mode', () => {
    const all = deliveryHeaderOf(readings('all'));
    for (const mode of MODES) expect(deliveryHeaderOf(readings(mode))).toEqual(all);
  });

  it('gives different Fleet facts where the agents are narrowed by Mine, which the header must not do', () => {
    const byBranch = new Map(rows.map((r) => [r.branch, owners(r.assignee as string)]));
    const base = readings('mine');
    const narrowed = deliveryHeaderOf({ ...base, fleet: { ...base.fleet, agents: agentsForReader(agents, me, 'mine', byBranch) } });
    expect(narrowed.fleet).not.toEqual(deliveryHeaderOf(readings('all')).fleet);
  });
});

describe('deliveryHeaderOf follows the scope', () => {
  it('narrows You and Work items by the scope rows and keeps Fleet and Machine whole', () => {
    const release = deliveryHeaderOf(readings('all'));
    const base = readings('all');
    const mySprint = deliveryHeaderOf({ ...base, mappingInput: { ...base.mappingInput, rows: [rows[0]] } });
    expect(mySprint.work).not.toEqual(release.work);
    expect(mySprint.fleet).toEqual(release.fleet);
    expect(mySprint.machine).toEqual(release.machine);
  });
});
