import { describe, it, expect } from 'vitest';

import { extractTopics, type StoryDocument, type TicketDocument } from '../../src/server/topics.js';

const story = (overrides: Partial<StoryDocument>): StoryDocument => ({
  slug: 'a-story',
  title: 'a story',
  planTitles: [],
  ...overrides,
});

const ticket = (overrides: Partial<TicketDocument>): TicketDocument => ({
  number: '1',
  title: 'a ticket',
  ...overrides,
});

describe('extractTopics with tickets', () => {
  it('surfaces a topic matched only by tickets, with empty storySlugs', () => {
    const stories = [story({ slug: 'alpha-story', title: 'the alpha story' })];
    const tickets = [ticket({ number: '42', title: 'merge-queue breaks on retry' })];

    const topics = extractTopics(stories, tickets, 20);
    const found = topics.find((t) => t.topic === 'merge-queue');

    expect(found).toBeDefined();
    expect(found?.storySlugs).toEqual([]);
    expect(found?.ticketKeys).toEqual(['42']);
  });

  it('excludes a term in every story AND every ticket, keeps one in every story but only some tickets', () => {
    const stories = [
      story({ slug: 'one', title: 'merge queue one' }),
      story({ slug: 'two', title: 'merge queue two' }),
    ];
    const tickets = [
      ticket({ number: '1', title: 'merge queue fails' }),
      ticket({ number: '2', title: 'merge queue flakes' }),
      ticket({ number: '3', title: 'unrelated dispatch wave issue' }),
    ];

    const topics = extractTopics(stories, tickets, 20);

    // present in every story (2/2) and in 2 of 3 tickets is not the same as
    // present in every ROW: 2 stories + 2 of 3 tickets = 4 of 5.
    const mergeQueue = topics.find((t) => t.topic === 'merge queue');
    expect(mergeQueue).toBeDefined();
    expect(mergeQueue?.count).toBe(4);
  });

  it('drops a term present in every story and every ticket', () => {
    const stories = [
      story({ slug: 'one', title: 'universal term one' }),
      story({ slug: 'two', title: 'universal term two' }),
    ];
    const tickets = [
      ticket({ number: '1', title: 'universal term alpha' }),
      ticket({ number: '2', title: 'universal term beta' }),
    ];

    const topics = extractTopics(stories, tickets, 20);
    expect(topics.find((t) => t.topic === 'universal term')).toBeUndefined();
  });

  it('sums story and ticket matches into one count', () => {
    const stories = [
      story({ slug: 'one', title: 'shared topic one' }),
      story({ slug: 'two', title: 'shared topic two' }),
      story({ slug: 'three', title: 'no match here' }),
    ];
    const tickets = [
      ticket({ number: '1', title: 'shared topic ticket' }),
      ticket({ number: '2', title: 'no match either' }),
    ];

    const topics = extractTopics(stories, tickets, 20);
    const found = topics.find((t) => t.topic === 'shared topic');

    expect(found).toBeDefined();
    expect(found?.count).toBe(3);
    expect(found?.storySlugs.sort()).toEqual(['one', 'two']);
    expect(found?.ticketKeys).toEqual(['1']);
  });

  it('reads terms from story content independently of title, slug, and plan titles', () => {
    const stories = [
      story({
        slug: 'alpha',
        title: 'alpha story',
        planTitles: ['alpha plan'],
        content: 'this story is about body-only-term in its design notes',
      }),
      story({
        slug: 'beta',
        title: 'beta story',
        planTitles: ['beta plan'],
        content: 'another mention of body-only-term here too',
      }),
      // A third, unrelated story so the term is not present in EVERY story —
      // otherwise the "every row" exclusion (correctly) drops it as noise.
      story({ slug: 'gamma', title: 'gamma story', planTitles: ['gamma plan'] }),
    ];

    const topics = extractTopics(stories, [], 20);
    const found = topics.find((t) => t.topic === 'body-only-term');

    expect(found).toBeDefined();
    expect(found?.storySlugs.sort()).toEqual(['alpha', 'beta']);
  });

  it('returns [] for no stories and no tickets', () => {
    expect(extractTopics([], [])).toEqual([]);
  });
});
