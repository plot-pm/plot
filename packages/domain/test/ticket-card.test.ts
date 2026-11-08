import { describe, expect, it } from 'vitest';
import { ticketCardIssueRow } from '../src/rules/ticket-card.js';
import type { TicketLaneRow } from '../src/rules/ticket-lanes.js';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const MINUTE_MS = 60 * 1000;
const ago = (minutes: number): string => new Date(NOW - minutes * MINUTE_MS).toISOString();

const row = (over: Partial<TicketLaneRow> = {}): TicketLaneRow => ({
  id: '1688',
  title: 'The Jira project scope: ship the connector',
  url: 'https://github.com/plot-pm/plot/issues/1688',
  createdAt: ago(10),
  body: null,
  status: 'Open',
  statusCategory: 'To Do',
  closedAt: null,
  type: null,
  owner: null,
  assignees: [],
  source: null,
  ...over,
});

describe('ticketCardIssueRow', () => {
  it('maps the fields CreatePlanButton and CreateStoryButton read', () => {
    const mapped = ticketCardIssueRow(row());
    expect(mapped).toEqual({
      kind: 'ticket',
      number: '1688',
      title: 'The Jira project scope: ship the connector',
      url: 'https://github.com/plot-pm/plot/issues/1688',
      ageMinutes: null,
      status: 'Open',
      statusCategory: 'To Do',
      assignees: [],
      type: null,
      owner: null,
    });
  });
});
