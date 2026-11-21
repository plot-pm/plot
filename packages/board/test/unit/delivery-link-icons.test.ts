import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deliveryHeader, type LinkIconKind, type ReleaseGroupView } from '@plot-pm/domain';
import { readFileSync } from 'node:fs';
import { IssueRowSchema } from '../../src/contract/schema.js';
import { LinkIcon, LINK_GLYPH } from '../../src/app/components/LinkIcon.js';
import { GLYPH_PATH } from '../../src/app/lib/glyphs.js';
import { LinePr, LineSlice, PlanName, PlanOwner } from '../../src/app/components/ReleasePlanParts.js';
import { DeliveryHeader } from '../../src/app/components/DeliveryHeader.js';
import { ReleaseGroup } from '../../src/app/components/ReleaseGroup.js';
import { TicketsSectionView } from '../../src/app/components/TicketsSection.js';
import { MasterAgentLine, RowCell, type LinkHandlers } from '../../src/app/components/DeliveryRows.js';

/**
 * Every Delivery-tab artifact draws as a link tuple: a bordered `data-link-tuple` pill whose segments each name their
 * kind in `data-tuple-what`. The to-do list and a plan's owner keep the bare `LinkIcon`.
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

/** The markup of the `data-link-tuple` pill that holds the first match of `marker`, or `null` where none holds it. */
const tupleAround = (markup: string, marker: string): string | null => {
  const at = markup.indexOf(marker);
  if (at < 0) throw new Error(`no ${marker} in ${markup}`);
  const open = markup.lastIndexOf('<span data-link-tuple', at);
  if (open < 0) return null;
  let depth = 0;
  for (const tag of markup.slice(open).matchAll(/<(\/?)span\b[^>]*>/g)) {
    depth += tag[1] === '/' ? -1 : 1;
    if (depth === 0) {
      const end = open + tag.index + tag[0].length;
      return end > at ? markup.slice(open, end) : null;
    }
  }
  return null;
};

/** The segment kinds of the tuple holding `marker`, in order: each segment's glyph names its kind. */
const kindsAround = (markup: string, marker: string): string[] | null => {
  const tuple = tupleAround(markup, marker);
  return tuple === null ? null : [...tuple.matchAll(/data-tuple-what="([a-z]+)"/g)].map((m) => m[1]!);
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
  it('draws the plan name as a plan tuple, its ticket keys first', () => {
    const plain = html(createElement(PlanName, { plan: { plan: 'red-hold', label: 'red-hold', keys: [], planFile: 'x.md', href: '/plan/x.md' }, open: false, onToggle: () => {} }));
    expect(kindsAround(plain, 'data-plan-link')).toEqual(['plan']);
    const keyed = html(createElement(PlanName, {
      plan: { plan: 'red-hold', label: 'EKP-77 EKP-78 red-hold', keys: [{ key: 'EKP-77', text: 'EKP-77' }, { key: 'EKP-78', text: 'EKP-78' }], planFile: 'x.md', href: '/plan/x.md' },
      open: false, onToggle: () => {},
    }));
    expect(tupleAround(keyed, 'data-plan-link')).toContain('EKP-78');
    expect(kindsAround(keyed, 'data-plan-link')).toEqual(['ticket', 'plan']);
  });

  it('draws an opened line\'s slice as a slice tuple, linked or not', () => {
    const line = { heading: 'done' as const, slice: 'Beds', text: '✓ merged · Beds · #12', pr: 12 };
    expect(kindsAround(html(createElement(LineSlice, { line, onJump: () => {} })), 'data-plan-line-link')).toEqual(['wave']);
    expect(kindsAround(html(createElement(LineSlice, { line })), 'Beds')).toEqual(['wave']);
  });

  it('draws the line\'s PR as a PR tuple, linked or not', () => {
    const linked = html(createElement(LinePr, { pr: 3478, url: 'https://h/pull/3478' }));
    expect(kindsAround(linked, 'data-plan-line-pr')).toEqual(['pr']);
    expect(linked).toMatch(/<a [^>]*data-plan-line-pr="3478"/);
    const text = html(createElement(LinePr, { pr: 3478, url: null }));
    expect(kindsAround(text, 'data-plan-line-pr')).toEqual(['pr']);
    expect(text).not.toContain('<a ');
  });

  it('leads the owner with the person icon', () => {
    expect(iconBefore(html(createElement(PlanOwner, { owner: 'jwloka' })), 'jwloka')).toBe('agent');
  });
});

describe('the header links', () => {
  const header = deliveryHeader({
    you: { counts: [{ key: 'tickets', count: 1 }], ages: [], releases: [], ticketNote: null }, work: { groups: [], ages: [] }, unplaced: [],
    agents: [], supervisor: null, switches: { dispatch: false, review: false, verify: false, design: false }, parallelAgents: null,
    machine: null, hostAnswer: 'unasked',
  });
  const m = html(createElement(DeliveryHeader, { header, release: null, onJump: () => {} }));

  it('leads the You group\'s triage link with the ticket icon', () => {
    expect(iconBefore(m, 'triage ›')).toBe('ticket');
  });
});

describe('the Release group', () => {
  const HEAD = 'a'.repeat(40);
  const ready = { open: true, headSha: HEAD, checksSha: HEAD, ciChecks: 'green', plotReview: 'success', plotReviewSha: HEAD, plotReviewJudged: 'success', plotReviewCheckedSha: HEAD } as const;
  const group: ReleaseGroupView = {
    scope: 'my-sprint', kind: 'targeted', title: '2.35.0 · 2.36.0', scopeLine: 'my sprint · Sprint one',
    sprints: [{ slug: 's1', title: 'Sprint one' }], bar: null, total: 0, readingMissing: false, unknownOwners: [],
    candidates: [
      { key: 'release:2.35.0', anchor: 'release-card-2.35.0', version: '2.35.0', rowId: 'r35', pr: 335, unboundReason: '' },
      { key: 'release:2.36.0', anchor: 'release-card-2.36.0', version: '2.36.0', rowId: 'r36', pr: 336, unboundReason: '' },
    ],
  };
  const m = html(createElement(ReleaseGroup, { view: { group, rows: {}, prReading: { r35: ready, r36: ready } } }));

  it('draws the title as a release tuple of text, because the payload holds no release URL', () => {
    expect(kindsAround(m, '2.35.0 · 2.36.0')).toEqual(['release']);
    expect(m).toContain('data-tuple-text="release"');
  });

  it('draws each sprint and each other ready PR as a tuple', () => {
    expect(kindsAround(m, '>Sprint one<')).toEqual(['sprint']);
    expect(kindsAround(m, '#336')).toEqual(['pr']);
  });
});

describe('the Tickets section', () => {
  const issue = IssueRowSchema.parse({ number: '3468', title: 'The Delivery tab reads at a glance', url: 'https://h/issues/3468', state: 'open' });
  const m = html(createElement(TicketsSectionView, {
    issueAnswer: 'answered', assigned: [issue], others: [], unassigned: 0, hidden: 0, showAll: false, onToggleShowAll: () => {},
    hiddenSentence: null, notice: null, absence: '', idea: { available: true, reason: '' }, story: { available: true, reason: '' },
    folded: false, onToggleFold: () => {}, foldOpen: false, onToggleFoldOpen: () => {},
  }));

  it('draws each ticket as a ticket tuple linked to its issue, its title after it', () => {
    expect(kindsAround(m, 'data-issue-link')).toEqual(['ticket']);
    expect(m).toMatch(/<a href="https:\/\/h\/issues\/3468"[^>]*data-issue-link=""[^>]*data-issue-number=""/);
    expect(tupleAround(m, 'data-issue-link')).not.toContain('The Delivery tab reads at a glance');
  });

  it('draws the row\'s ⋯ menu in the last cell, with no artifact icon and no bare Plan it', () => {
    const doCell = m.slice(m.indexOf('data-row-cell="do"'));
    expect(doCell).toContain('data-issue-actions="3468"');
    expect(tupleAround(doCell, 'data-issue-actions')).toBeNull();
    expect(m).not.toContain('Plan it');
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
    onJump: () => undefined,
  };
  const cell = (c: Parameters<typeof RowCell>[0]['cell']) => html(createElement(RowCell, { cell: c, handlers }));

  it('draws each cell link as the tuple of its target', () => {
    expect(kindsAround(cell({ value: 'feature/x', links: [{ to: 'branch', branch: 'feature/x' }] }), 'data-row-link')).toEqual(['branch']);
    expect(kindsAround(cell({ value: 'p', links: [{ to: 'plan', plan: 'p', slice: null }] }), 'data-row-link')).toEqual(['plan']);
    const both = cell({ value: 'feature/x', links: [{ to: 'branch', branch: 'feature/x' }, { to: 'pr', pr: 7 }] });
    expect(kindsAround(both, '#7')).toEqual(['pr']);
  });

  it('draws no tuple for a Do verb or a gate mark, a text segment for a link that goes nowhere, and no glyph for a role-chipped agent', () => {
    expect(cell({ value: 'Approve', links: [{ to: 'action', action: 'approve', id: 'p' }] })).not.toContain('data-link-tuple');
    expect(cell({ value: 'CI ⟳', links: [], parts: [{ value: 'CI ⟳', link: { to: 'checks', pr: 7 } }] })).not.toContain('data-link-tuple');
    const nowhere = cell({ value: 'x', links: [{ to: 'url', url: '' }] });
    expect(nowhere).toContain('data-tuple-text="external"');
    expect(nowhere).not.toContain('<a ');
    const agent = cell({ value: 'a1', links: [{ to: 'agent', id: 'a1' }], agent: { role: 'loop', attempt: null } });
    expect(agent).toContain('data-link-tuple');
    expect(agent).not.toContain('data-tuple-what');
  });

  it('draws the Master Agent branch as a branch tuple, linked or not', () => {
    const linked = html(createElement(MasterAgentLine, { branch: 'main', branchUrlBase: 'https://h/tree/' }));
    expect(kindsAround(linked, 'href="https://h/tree/main"')).toEqual(['branch']);
    expect(kindsAround(html(createElement(MasterAgentLine, { branch: 'main', branchUrlBase: '' })), 'data-tuple-text="branch"')).toEqual(['branch']);
  });
});

describe('the Delivery components outside a tuple', () => {
  const source = (file: string) => readFileSync(new URL(`../../src/app/components/${file}`, import.meta.url), 'utf8');

  it('draw no bare LinkIcon at the sites that now draw a tuple', () => {
    for (const file of ['TicketsSection.tsx', 'ReleaseGroup.tsx', 'DeliveryRows.tsx', 'AgentList.tsx']) {
      expect(source(file), file).not.toContain('<LinkIcon');
    }
    const parts = source('ReleasePlanParts.tsx');
    expect(parts.match(/<LinkIcon/g)).toHaveLength(1);
    expect(parts.slice(parts.indexOf('export const PlanOwner'))).toContain('<LinkIcon');
  });
});
