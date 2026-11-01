import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { planIndexOf } from '@plot-pm/domain';
import { card, sprint, story } from '../catalogue/index.js';
import { PlanCard } from '../../src/app/components/PlanCard.js';
import { PlanModal } from '../../src/app/components/PlanModal.js';
import { StoryModal } from '../../src/app/components/StoryModal.js';
import { SprintModal } from '../../src/app/components/SprintModal.js';

const withIssue = card({
  slug: 'one-ticket', title: 'One ticket', type: 'feature', phase: 'Development',
  path: 'docs/plans/2026-11-01-one-ticket.md', prs: [], phaseDate: '2026-11-01', issues: ['1089'],
  story: 'a-story',
});

describe('panels show the plan reference prefix', () => {
  it('PlanCard heading starts with the issue key and its Open anchor uses planRoute', () => {
    const html = renderToStaticMarkup(createElement(PlanCard, {
      card: withIssue, accent: 'neutral', showSprint: false, showStory: false,
      dispatch: undefined as never, approve: undefined as never, interrogate: undefined as never,
      onStarting: () => {}, onOpen: () => {},
    }));
    expect(html).toContain('data-plan-ref');
    expect(html).toContain('1089: One ticket');
    expect(html).toContain('href="/plan/2026-11-01-one-ticket.md"');
  });

  it('PlanCard prints the title alone for a plan with no issues', () => {
    const html = renderToStaticMarkup(createElement(PlanCard, {
      card: { ...withIssue, issues: [] }, accent: 'neutral', showSprint: false, showStory: false,
      dispatch: undefined as never, approve: undefined as never, interrogate: undefined as never,
      onStarting: () => {}, onOpen: () => {},
    }));
    expect(html).not.toContain('1089');
  });

  it('PlanModal names the plan with its prefix in the accessible label', () => {
    const html = renderToStaticMarkup(createElement(PlanModal, { card: withIssue, onClose: () => {} }));
    expect(html).toContain('1089: One ticket');
  });

  it('StoryModal lists its plans through PlanReference', () => {
    const html = renderToStaticMarkup(createElement(StoryModal, {
      story: story({ slug: 'a-story', title: 'A story' }),
      cards: [withIssue], phases: ['Development'], onClose: () => {},
    }));
    expect(html).toContain('data-plan-ref');
    expect(html).toContain('1089: one-ticket');
    expect(html).toContain('href="/plan/2026-11-01-one-ticket.md"');
  });

  it('SprintModal prefixes a member with a card and shows a member without one as text with the ? mark', () => {
    const members = [
      { slug: 'one-ticket', text: '', tier: 'must' as const, checked: false, known: true },
      { slug: 'gone', text: '', tier: 'must' as const, checked: false, known: false },
    ];
    const html = renderToStaticMarkup(createElement(SprintModal, {
      sprint: sprint({ slug: 's', title: 'S', members }),
      onClose: () => {}, onOpenPlan: () => true,
      planIndex: planIndexOf({ cards: [withIssue] }),
    }));
    expect(html).toContain('1089: ');
    expect(html).toContain('href="/plan/2026-11-01-one-ticket.md"');
    const gone = html.slice(html.indexOf('gone') - 200, html.indexOf('gone') + 80);
    expect(gone).not.toContain('<a ');
    expect(html).toContain('title="Plan not found in board"');
  });
});
