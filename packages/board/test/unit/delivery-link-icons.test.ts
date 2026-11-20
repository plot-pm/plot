import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LinkIconKind, ReleaseCardView, TodoList as TodoListFact } from '@plot-pm/domain';
import { IssueRowSchema } from '../../src/contract/schema.js';
import { LinkIcon, LINK_GLYPH } from '../../src/app/components/LinkIcon.js';
import { GLYPH_PATH } from '../../src/app/lib/glyphs.js';
import { LinePr, LineSlice, PlanName, PlanOwner } from '../../src/app/components/ReleasePlanParts.js';
import { TodoList } from '../../src/app/components/TodoList.js';
import { ReleaseCard } from '../../src/app/components/ReleaseCard.js';
import { TicketsSectionView } from '../../src/app/components/TicketsSection.js';
import { MasterAgentLine, RowCell, type LinkHandlers } from '../../src/app/components/DeliveryRows.js';

/**
 * Every Delivery-tab link that names a place is led by the icon of that place's kind:
 * an `aria-hidden` Octicon from `glyphs.ts`, `data-link-icon` naming the kind, placed before the link.
 */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

/** The kind of the icon that comes immediately before the first match of `marker`, or `null`. */
const iconBefore = (markup: string, marker: string): string | null => {
  const at = markup.indexOf(marker);
  if (at < 0) throw new Error(`no ${marker} in ${markup}`);
  const head = markup.slice(0, at);
  // A marker inside a tag's attributes starts the comparison at that tag's `<`.
  const before = head.lastIndexOf('<') > head.lastIndexOf('>') ? head.slice(0, head.lastIndexOf('<')) : head;
  const icons = [...before.matchAll(/<svg[^>]*data-link-icon="([a-z]+)"[^>]*>.*?<\/svg>/g)];
  const last = icons.at(-1);
  if (last === undefined) return null;
  const between = before.slice(last.index + last[0].length).replace(/<[^>]+>/g, '');
  return between.trim() === '' ? last[1]! : null;
};

describe('LinkIcon', () => {
  it('draws each kind with its glyph from glyphs.ts, hidden from assistive technology, one em of the text', () => {
    for (const kind of Object.keys(LINK_GLYPH) as LinkIconKind[]) {
      const svg = html(createElement(LinkIcon, { kind }));
      expect(svg).toContain(`data-link-icon="${kind}"`);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('width="1em"');
      expect(svg).toContain(`<path d="${GLYPH_PATH[LINK_GLYPH[kind]]}"`);
    }
  });

  it('draws nothing for a target with no kind of place', () => {
    expect(html(createElement(LinkIcon, { kind: null }))).toBe('');
  });
});

describe('the Release delivery links', () => {
  it('leads the plan name with the plan icon', () => {
    const m = html(createElement(PlanName, { plan: { plan: 'red-hold', label: 'red-hold', keys: [], planFile: 'x.md', href: '/plan/x.md' }, open: false, onToggle: () => {} }));
    expect(iconBefore(m, 'data-plan-link')).toBe('plan');
  });

  it('leads an opened line\'s slice with the slice icon, linked or not', () => {
    const line = { heading: 'done' as const, slice: 'Beds', text: '✓ merged · Beds · #12', pr: 12 };
    expect(iconBefore(html(createElement(LineSlice, { line, onJump: () => {} })), 'data-plan-line-link')).toBe('slice');
    expect(iconBefore(html(createElement(LineSlice, { line })), 'Beds')).toBe('slice');
  });

  it('leads the line\'s PR with the PR icon, linked or not', () => {
    expect(iconBefore(html(createElement(LinePr, { pr: 3478, url: 'https://h/pull/3478' })), 'data-plan-line-pr')).toBe('pr');
    expect(iconBefore(html(createElement(LinePr, { pr: 3478, url: null })), 'data-plan-line-pr')).toBe('pr');
  });

  it('leads the owner with the person icon', () => {
    expect(iconBefore(html(createElement(PlanOwner, { owner: 'jwloka' })), 'jwloka')).toBe('agent');
  });
});

describe('the to-do list links', () => {
  const todo: TodoListFact = {
    lines: [
      { id: 'b', text: 'Merge feature/x', verb: 'Merge', label: 'feature/x', marker: 'clean-up', markerWords: 'clean up', anchor: 'b', icon: 'branch' },
      { id: 'p', text: 'Approve red-hold', verb: 'Approve', label: 'red-hold', marker: 'blocks-delivery', markerWords: 'blocks delivery', anchor: 'p', icon: 'plan' },
      { id: 'r', text: 'Approve release 2.35.0', verb: 'Approve release', label: '2.35.0', marker: 'blocks-delivery', markerWords: 'blocks delivery', anchor: 'r', icon: 'release' },
    ],
    counts: { 'blocks-delivery': 2, input: 0, 'clean-up': 1 },
    header: 'You block 2 deliveries · 1 to clean up',
    tickets: 1,
    triageText: '1 ticket assigned to you with no plan',
    triageAnchor: 'tickets',
    triageIcon: 'ticket',
  };
  const m = html(createElement(TodoList, { todo, onJump: () => {} }));

  it('leads each line\'s name with the icon of the item it names', () => {
    expect(iconBefore(m, 'title="feature/x"')).toBe('branch');
    expect(iconBefore(m, 'title="red-hold"')).toBe('plan');
    expect(iconBefore(m, 'title="2.35.0"')).toBe('release');
  });

  it('leads the triage link with the ticket icon', () => {
    expect(iconBefore(m, 'triage ›')).toBe('ticket');
  });
});

describe('the release card', () => {
  it('leads the card title with the release icon', () => {
    const card: ReleaseCardView = {
      key: 'v2.35.0', kind: 'planned', anchor: 'release-card-2.35.0', version: '2.35.0', title: 'Release 2.35.0', bar: null, total: 0,
      readingMissing: false, missingText: '', people: 1, peopleText: '1 person', stateText: 'planned · no release PR yet', rowId: null,
      unboundReason: 'no release PR yet',
    } as ReleaseCardView;
    expect(iconBefore(html(createElement(ReleaseCard, { cards: [card], rows: {} })), 'data-release-card-title')).toBe('release');
  });
});

describe('the Tickets section', () => {
  const issue = IssueRowSchema.parse({ number: '3468', title: 'The Delivery tab reads at a glance', url: 'https://h/issues/3468', state: 'open' });
  const m = html(createElement(TicketsSectionView, {
    issueAnswer: 'answered', assigned: [issue], others: [], unassigned: 0, hidden: 0, showAll: false, onToggleShowAll: () => {},
    hiddenSentence: null, notice: null, absence: '', idea: { available: true, reason: '' },
  }));

  it('leads each ticket link with the ticket icon', () => {
    expect(iconBefore(m, 'data-issue-link')).toBe('ticket');
  });

  it('leads Plan it with the plan icon', () => {
    expect(iconBefore(m.slice(m.indexOf('data-tickets-do')), 'Plan it')).toBe('plan');
  });
});

describe('the cell links and the Master Agent line', () => {
  const handlers: LinkHandlers = {
    context: {
      plan: 'p',
      branchUrlBase: 'https://h/tree/',
      prUrl: (pr) => `https://h/pull/${pr}`,
      checksUrl: (pr) => `https://h/pull/${pr}/checks`,
      planFileOf: () => 'p.md',
      branchOfAgent: () => '',
    },
    onPlan: () => undefined,
    onReveal: () => undefined,
    onAct: () => undefined,
  };
  const cell = (c: Parameters<typeof RowCell>[0]['cell']) => html(createElement(RowCell, { cell: c, handlers }));

  it('leads each cell link with the icon of its target', () => {
    expect(iconBefore(cell({ value: 'feature/x', links: [{ to: 'branch', branch: 'feature/x' }] }), 'feature/x')).toBe('branch');
    expect(iconBefore(cell({ value: 'p', links: [{ to: 'plan', plan: 'p', slice: null }] }), 'data-row-link')).toBe('plan');
    const both = cell({ value: 'feature/x', links: [{ to: 'branch', branch: 'feature/x' }, { to: 'pr', pr: 7 }] });
    expect(iconBefore(both, '#7')).toBe('pr');
  });

  it('draws no icon for a Do verb, a gate mark, a link that goes nowhere, or a role-chipped agent', () => {
    expect(cell({ value: 'Approve', links: [{ to: 'action', action: 'approve', id: 'p' }] })).not.toContain('data-link-icon');
    expect(cell({ value: 'CI ⟳', links: [], parts: [{ value: 'CI ⟳', link: { to: 'checks', pr: 7 } }] })).not.toContain('data-link-icon');
    expect(cell({ value: 'x', links: [{ to: 'url', url: '' }] })).not.toContain('data-link-icon');
    expect(cell({ value: 'a1', links: [{ to: 'agent', id: 'a1' }], agent: { role: 'loop', attempt: null } })).not.toContain('data-link-icon');
  });

  it('leads the Master Agent branch with the branch icon, linked or not', () => {
    expect(iconBefore(html(createElement(MasterAgentLine, { branch: 'main', branchUrlBase: 'https://h/tree/' })), '>main<')).toBe('branch');
    expect(iconBefore(html(createElement(MasterAgentLine, { branch: 'main', branchUrlBase: '' })), '>main<')).toBe('branch');
  });
});
