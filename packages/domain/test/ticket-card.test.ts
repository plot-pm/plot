import { describe, expect, it } from 'vitest';
import {
  ticketCardAge,
  ticketCardIcon,
  ticketCardIssueRow,
  ticketCardReference,
  ticketCardShowsActions,
  ticketCardSubtitle,
  ticketCardView,
} from '../src/rules/ticket-card.js';
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
  ...over,
});

describe('ticketCardIcon', () => {
  it('reads open where closedAt is null', () => {
    expect(ticketCardIcon(null)).toBe('open');
  });

  it('reads closed where closedAt is set', () => {
    expect(ticketCardIcon(ago(5))).toBe('closed');
  });
});

describe('ticketCardReference', () => {
  it('reads owner/repo#number from a GitHub issue url', () => {
    expect(ticketCardReference('https://github.com/plot-pm/plot/issues/1688')).toBe('plot-pm/plot#1688');
  });

  it('reads owner/repo#number from a Bitbucket issue url', () => {
    expect(ticketCardReference('https://bitbucket.org/acme/widgets/issues/42')).toBe('acme/widgets#42');
  });

  it('reads the key alone from a Jira browse url', () => {
    expect(ticketCardReference('https://acme.atlassian.net/browse/PROJ-12')).toBe('PROJ-12');
  });

  it('gives no reference for a url it cannot read, never a guessed one', () => {
    expect(ticketCardReference('https://example.com/not-a-ticket')).toBe('');
    expect(ticketCardReference('')).toBe('');
  });
});

describe('ticketCardAge', () => {
  it('reads minutes under an hour', () => {
    expect(ticketCardAge(ago(10), NOW)).toBe('10m');
  });

  it('reads hours under a day', () => {
    expect(ticketCardAge(ago(3 * 60), NOW)).toBe('3h');
  });

  it('reads days under 60', () => {
    expect(ticketCardAge(ago(5 * 24 * 60), NOW)).toBe('5d');
  });

  it('reads months at 60 days and beyond', () => {
    expect(ticketCardAge(ago(90 * 24 * 60), NOW)).toBe('3mo');
  });

  it('gives null where createdAt cannot be read', () => {
    expect(ticketCardAge(null, NOW)).toBeNull();
    expect(ticketCardAge('not-a-date', NOW)).toBeNull();
  });
});

describe('ticketCardSubtitle', () => {
  it('joins the reference and the age where both are readable', () => {
    expect(ticketCardSubtitle('plot-pm/plot#1688', '10m')).toBe('plot-pm/plot#1688 · opened 10m ago');
  });

  it('falls back to the age alone where the reference cannot be read', () => {
    expect(ticketCardSubtitle('', '10m')).toBe('opened 10m ago');
  });

  it('falls back to the reference alone where the age cannot be read', () => {
    expect(ticketCardSubtitle('plot-pm/plot#1688', null)).toBe('plot-pm/plot#1688');
  });

  it('gives an empty line where neither is readable', () => {
    expect(ticketCardSubtitle('', null)).toBe('');
  });
});

describe('ticketCardShowsActions', () => {
  it('shows actions on the open lane', () => {
    expect(ticketCardShowsActions('open')).toBe(true);
  });

  it('shows actions on the in-progress lane', () => {
    expect(ticketCardShowsActions('in-progress')).toBe(true);
  });

  it('shows no action on the done lane', () => {
    expect(ticketCardShowsActions('done')).toBe(false);
  });

  it('shows no action on the hidden lane', () => {
    expect(ticketCardShowsActions('hidden')).toBe(false);
  });
});

describe('ticketCardView', () => {
  it('builds the open-lane card from a GitHub row', () => {
    const view = ticketCardView(row(), 'open', NOW);
    expect(view.icon).toBe('open');
    expect(view.heading).toBe('1688: The Jira project scope: ship the connector');
    expect(view.subtitle).toBe('plot-pm/plot#1688 · opened 10m ago');
    expect(view.url).toBe('https://github.com/plot-pm/plot/issues/1688');
    expect(view.showsActions).toBe(true);
  });

  it('uses a Jira ticket’s key as its shorthand, not a numeric id', () => {
    const view = ticketCardView(
      row({ id: 'PROJ-12', url: 'https://acme.atlassian.net/browse/PROJ-12' }),
      'open',
      NOW,
    );
    expect(view.heading.startsWith('PROJ-12:')).toBe(true);
    expect(view.subtitle).toBe('PROJ-12 · opened 10m ago');
  });

  it('shows actions on an in-progress row whose closedAt is already set — the lane decides, not closedAt', () => {
    const view = ticketCardView(row({ closedAt: ago(5) }), 'in-progress', NOW);
    expect(view.icon).toBe('closed');
    expect(view.showsActions).toBe(true);
  });

  it('shows no action on a done row', () => {
    const view = ticketCardView(row({ closedAt: ago(5) }), 'done', NOW);
    expect(view.showsActions).toBe(false);
  });

  it('renders a reference-less subtitle, never a blank one or a throw, where the url cannot be read', () => {
    const view = ticketCardView(row({ url: 'not-a-url' }), 'open', NOW);
    expect(view.subtitle).toBe('opened 10m ago');
    expect(view.url).toBe('not-a-url');
  });
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
    });
  });
});
