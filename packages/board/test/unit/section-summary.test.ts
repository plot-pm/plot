import { describe, it, expect } from 'vitest';
import { parsePersonDirectory, type MineMode, type Reader } from '@plot-pm/domain';
import { deliveryHeaderOf } from '../../src/app/lib/agent-rows/delivery-header.js';
import { agentsForReader, type PlanOwners } from '../../src/app/lib/agent-rows/mine-filter.js';
import type { DeliveryMapInput, RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';
import { sectionSummariesOf, summaryCounts, type SectionSummaryReadings } from '../../src/app/lib/agent-rows/section-summary.js';
import type { AgentRow } from '../../src/contract/schema.js';
import type { ScopeTicketGroup, ScopeTicketRow, ScopeTickets } from '@plot-pm/domain/rules/scope-tickets';

const me: Reader = { hostUser: 'jwloka', directory: parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht') };
const MODES: readonly MineMode[] = ['all', 'mine-and-unknown', 'mine'];
const SCOPES = ['release', 'my-sprint'] as const;
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
const byBranch = new Map(rows.map((r) => [r.branch, owners(r.assignee as string)]));
// `agentsForReader` drops this agent in `mine-and-unknown` and `mine`: it runs
// elsewhere, on a plan of another person.
const dropped = agentOn('t', 'feature/theirs', 'elsewhere');
const agents = [agentOn('o', 'feature/ours', 'running'), dropped];

/** The readings as the tab passes them: the mapping input carries the agents Mine keeps, and the scope its rows. */
const readings = (mode: MineMode, scope: (typeof SCOPES)[number] = 'release'): SectionSummaryReadings => ({
  mappingInput: {
    rows: scope === 'release' ? rows : [rows[0]],
    slices: [], agents: agentsForReader(agents, me, mode, byBranch), drafts: [], reader: me, mode,
    config: { autoReview: true, correctionBudget: 2 },
  } as DeliveryMapInput,
  fleet: {
    agents,
    supervisor: { state: 'up', prominence: 'quiet', shown: false, label: 'fleet running', detail: '' },
    fleetControls: { autoDispatch: true, parallelAgents: 3 },
    autoReview: true,
    machine: null,
    prAgeSeconds: 10, prError: null,
    issueAnswer: 'answered', issueError: null, prNextInSeconds: null, issueAgeSeconds: null,
  } as unknown as SectionSummaryReadings['fleet'],
  reader: me,
  phaseMap: undefined,
  stories: [],
  cards: [],
  scope: { kind: scope, sprints: [] },
  tickets: { issues: [], before: 0, showAll: false },
});

const cells = MODES.flatMap((mode) => SCOPES.map((scope) => ({ mode, scope })));

describe('sectionSummariesOf', () => {
  it('holds an agent that agentsForReader drops, so the fixture bites', () => {
    expect(agentsForReader(agents, me, 'mine', byBranch)).not.toContain(dropped);
    expect(agentsForReader(agents, me, 'all', byBranch)).toContain(dropped);
  });

  it('agrees with the Delivery header on You, Work items and Fleet under Mine all, in both scopes', () => {
    for (const scope of SCOPES) {
      const r = readings('all', scope);
      const summaries = sectionSummariesOf(r);
      const header = deliveryHeaderOf(r);
      // An empty section shows its mark in place of the chips, so every header number reads 0 there.
      const agree = (summary: (typeof summaries)['you'], numbers: readonly { key: string; count: number }[]) => {
        const counts = summaryCounts(summary);
        for (const n of numbers) expect(summary.empty === null ? counts[n.key] : 0).toBe(n.count);
      };
      agree(summaries.you, header.you.numbers);
      agree(summaries['work-items'], header.work.numbers);
      const circles = summaries.fleet.parts.find((p) => p.kind === 'circles');
      expect(circles).toEqual({ kind: 'circles', circles: header.fleet.circles });
      expect(summaryCounts(summaries.fleet).unread ?? null).toBe(header.fleet.unread?.count ?? null);
    }
  });

  it('gives a summary for every section in all six scope and Mine cells', () => {
    for (const { mode, scope } of cells) {
      const summaries = sectionSummariesOf(readings(mode, scope));
      expect(Object.keys(summaries).sort()).toEqual(['fleet', 'machine', 'not-placed', 'release-delivery', 'tickets', 'work-items', 'you']);
      for (const summary of Object.values(summaries)) {
        expect(summary.empty !== null || summary.parts.length > 0).toBe(true);
      }
    }
  });

  it('narrows Fleet by Mine and keeps it whole across the scope', () => {
    const fleetOf = (mode: MineMode, scope: (typeof SCOPES)[number]) => sectionSummariesOf(readings(mode, scope)).fleet;
    expect(summaryCounts(fleetOf('all', 'release')).unread).toBe(1);
    expect(summaryCounts(fleetOf('mine', 'release')).unread).toBeUndefined();
    for (const mode of MODES) expect(fleetOf(mode, 'my-sprint')).toEqual(fleetOf(mode, 'release'));
  });

  it('keeps Machine equal in all six cells', () => {
    const machine = sectionSummariesOf(readings('all')).machine;
    for (const { mode, scope } of cells) expect(sectionSummariesOf(readings(mode, scope)).machine).toEqual(machine);
  });

  it('keeps Release delivery equal across the Mine modes', () => {
    for (const scope of SCOPES) {
      const all = sectionSummariesOf(readings('all', scope))['release-delivery'];
      for (const mode of MODES) expect(sectionSummariesOf(readings(mode, scope))['release-delivery']).toEqual(all);
    }
  });

  it('shows an empty section by its mark and no chips', () => {
    const summaries = sectionSummariesOf(readings('mine', 'my-sprint'));
    const empty = Object.values(summaries).filter((s) => s.empty !== null);
    expect(empty.length).toBeGreaterThan(0);
    for (const summary of empty) {
      expect(summary.parts).toEqual([]);
      expect(summary.anchors).toEqual({});
    }
    expect(summaries.tickets.empty).not.toBeNull();
  });

  it('adds the Delivered and Found chips from the scope groups, and a scope row keeps the summary from reading empty', () => {
    const group = (key: ScopeTicketGroup<ScopeTicketRow>['key'], count: number | null): ScopeTicketGroup<ScopeTicketRow> => ({
      key, label: key, heading: key, rows: [], count, hiddenByMine: 0, empty: '— none', incomplete: null, unread: count === null,
    });
    const scopeTickets: ScopeTickets<ScopeTicketRow> = {
      delivered: group('tickets-delivered', 2), found: group('tickets-found', 0), findingKeys: new Set(), noPlan: null,
    };
    const summaries = sectionSummariesOf({ ...readings('all'), scopeTickets });
    expect(summaries.tickets.empty).toBeNull();
    expect(summaryCounts(summaries.tickets)).toMatchObject({ delivered: 2, found: 0 });
    expect(sectionSummariesOf(readings('all')).tickets.empty).not.toBeNull();
  });
});
