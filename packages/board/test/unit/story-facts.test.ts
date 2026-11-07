import { describe, expect, it } from 'vitest';
import { parseStoryContent } from '../../src/server/board.js';
import { PlanMetaSchema, StoryCardSchema, type PlanMeta, type StoryCard } from '../../src/contract/schema.js';
import { storiesWithAvailability, storyFactsOf, ticketStoriesOf, type StoryFactsContext } from '../../src/server/story-facts.js';

const ISSUES = 'https://github.com/plot-pm/plot/issues/';

const context = (over: Partial<StoryFactsContext> = {}): StoryFactsContext => ({
  issueContext: { issuePrefix: ISSUES, jiraProjects: [] },
  plans: new Map(),
  sprints: [],
  directory: {},
  ...over,
});

const storyText = (frontmatter: string[]): string =>
  ['---', 'title: Nothing changed, nothing runs', 'status: draft', ...frontmatter, '---', '', '## Objective', '', 'Find out.', ''].join('\n');

const parse = (frontmatter: string[]) => {
  const input = parseStoryContent(storyText(frontmatter), 'nothing-runs', 'docs/stories/nothing-runs/STORY-nothing-runs.md', '');
  if (input === null) throw new Error('the fixture story did not parse');
  return input;
};

const meta = (over: Partial<PlanMeta>): PlanMeta =>
  PlanMetaSchema.parse({ file: 'docs/plans/2026-11-01-a.md', format: 'plot', phase: 'approved', ...over });

describe('a story names its ticket in issue:', () => {
  it('reads issue: from the frontmatter', () => {
    expect(parse([`issue: ${ISSUES}3170`]).issue).toBe(`${ISSUES}3170`);
  });

  it('drops a comment after the value, and keeps a value that starts with #', () => {
    expect(parse(['issue: {ISSUE_URL}  # Optional — link the ticket']).issue).toBe('');
    expect(parse(['issue: #3170  # the ticket']).issue).toBe('#3170');
    expect(parse([`issue: "${ISSUES}3170" # quoted`]).issue).toBe(`${ISSUES}3170`);
  });

  it('reads an empty issue: as none, never the next line', () => {
    expect(parse(['issue:', 'author: jwloka']).issue).toBe('');
  });

  it('reads the legacy jira: where issue: is absent, and its template placeholder as none', () => {
    expect(parse(['jira: PROJ-1']).issue).toBe('PROJ-1');
    expect(parse(['jira: {JIRA_TICKET_URL}  ']).issue).toBe('');
  });

  it("links the ticket its own repository's issue names", () => {
    const facts = storyFactsOf(parse([`issue: ${ISSUES}3170`]), [], false, context());
    expect(facts.identity.key).toBe('3170');
    expect(facts.lineage.tickets).toEqual({ value: [{ kind: 'ticket', key: '3170', title: '3170', lane: null }] });
  });

  it("alerts an issue of another repository and links no ticket", () => {
    const facts = storyFactsOf(parse(['issue: https://github.com/elsewhere/repo/issues/3170']), [], false, context());
    expect(facts.identity.alerts).toEqual([{ kind: 'issue-link-unreadable', value: 'https://github.com/elsewhere/repo/issues/3170' }]);
    expect(facts.lineage.tickets).toEqual({ value: [] });
  });

  it('reads the status the file writes, while the card field carries the derived standing', () => {
    const facts = storyFactsOf(parse([]), [meta({ story: 'nothing-runs', phase: 'released' })], false, context());
    expect(facts.progress.state).toEqual({ value: { kind: 'story', status: 'draft' } });
    expect(facts.identity.alerts).toEqual([{ kind: 'status-behind', proven: 'archived' }]);
  });

  it("reads each plan's measured status and first key from its card", () => {
    const facts = storyFactsOf(parse([]), [meta({ story: 'nothing-runs', title: 'A' })], false, context({
      plans: new Map([['a', { status: 'in-progress', issues: ['3092'] }]]),
    }));
    expect(facts.lineage.plans).toEqual({ value: [{ kind: 'plan', slug: 'a', key: '3092', title: 'A', status: 'in-progress' }] });
  });

  it('reads sprints as unknown where the sprints could not be read', () => {
    const facts = storyFactsOf(parse([]), [meta({ story: 'nothing-runs', sprint: 's1' })], false, context({ sprints: null }));
    expect(facts.lineage.sprints).toEqual({ unknown: 'failed' });
  });
});

const card = (over: Partial<StoryCard>): StoryCard =>
  StoryCardSchema.parse({ slug: 's', title: 'S', status: 'draft', declaredStatus: 'draft', committed: true, ...over });

describe('the ticket → story index', () => {
  it('is built from committed stories only', () => {
    const index = ticketStoriesOf([
      card({ slug: 'committed', issue: '#3170' }),
      card({ slug: 'local', issue: '#3170', committed: false }),
    ], true, [], context().issueContext);
    expect('value' in index && index.value['3170']?.map((r) => r.kind === 'story' && r.slug)).toEqual(['committed']);
  });

  it("holds a story a plan answering the ticket names in Story:", () => {
    const index = ticketStoriesOf([card({ slug: 'umbrella' })], true, [meta({ issues: ['3102'], story: 'umbrella' })], context().issueContext);
    expect('value' in index && Object.keys(index.value)).toEqual(['3102']);
  });

  it('is unknown, never empty, where the default branch was not read', () => {
    expect(ticketStoriesOf([card({ issue: '#1' })], false, [], context().issueContext)).toEqual({ unknown: 'failed' });
  });

  it('indexes no story whose issue: is unreadable', () => {
    const index = ticketStoriesOf([card({ issue: 'https://github.com/x/y/issues/1' })], true, [], context().issueContext);
    expect(index).toEqual({ value: {} });
  });
});

describe('Add plan follows what the board runs', () => {
  it('offers no Add plan on a story only the working tree holds', () => {
    expect(storyFactsOf(parse([]), [], false, context()).next).toEqual({ primary: null, secondary: [] });
  });

  it('disables Add plan with the board reason where the board cannot create plans', () => {
    const facts = storyFactsOf({ ...parse([]), committed: true }, [], false, context());
    expect(facts.next.primary).toEqual({ action: 'add-plan', enabled: true, reason: null });
    const [out] = storiesWithAvailability([{ facts }], { available: false, reason: 'not on localhost' });
    expect(out.facts?.next.primary).toEqual({
      action: 'add-plan', enabled: false, reason: { kind: 'action-unavailable', action: 'add-plan' },
    });
  });

  it('leaves a story without facts as it is', () => {
    expect(storiesWithAvailability([{ facts: undefined }], { available: true, reason: '' })).toEqual([{ facts: undefined }]);
  });
});
