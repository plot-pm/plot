import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { discoveryGroups, TICKETS_NOT_READ_REASON } from '@plot-pm/domain';
import { StoriesTab, type StoriesTabProps } from '../../src/app/components/StoriesTab.js';

const render = (over: Partial<StoriesTabProps> = {}): string =>
  renderToStaticMarkup(
    createElement(StoriesTab, {
      storyLaneGroups: [],
      tickets: null,
      plansUnreadable: false,
      topics: [],
      showArchived: false,
      onShowArchived: () => {},
      show: 'both',
      onShow: () => {},
      onOpenStory: () => {},
      idea: { available: false, reason: 'x' },
      story: { available: false, reason: 'x' },
      issueAnswer: 'unsupported',
      ...over,
    }),
  );

describe('an unread ticket group', () => {
  it('renders the board absence sentence the domain returned, and no Tickets heading', () => {
    const sentence = 'Open issues are not listed: the tracker has no connector.';
    const html = render({ issueAbsence: sentence });
    expect(html).toContain('data-discovery-reason="tickets"');
    expect(html).toContain(discoveryGroups('both', [], null, sentence).tickets.reason);
    expect(html).not.toContain('data-discovery-group="tickets"');
  });

  it('renders the generic reason where no sentence is known', () => {
    expect(render()).toContain(TICKETS_NOT_READ_REASON);
  });

  it('renders no reason where the reader chose stories alone', () => {
    expect(render({ show: 'stories' })).not.toContain('data-discovery-reason');
  });
});
