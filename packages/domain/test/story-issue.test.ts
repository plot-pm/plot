import { describe, expect, it } from 'vitest';
import {
  jiraProjectsOf,
  repoIssuePrefixOf,
  storyIsLive,
  storyIssueLink,
  storyIssueValue,
  ticketStoryIndex,
  type IndexedStory,
  type StoryIssueContext,
} from '../src/rules/story-issue.js';

const github: StoryIssueContext = { issuePrefix: 'https://github.com/plot-pm/plot/issues/', jiraProjects: [] };
const bitbucket: StoryIssueContext = { issuePrefix: 'https://bitbucket.org/quatico/site/issues/', jiraProjects: [] };

describe('storyIssueValue', () => {
  it('reads issue: first', () => {
    expect(storyIssueValue('#3170', 'PROJ-1')).toBe('#3170');
  });

  it('reads the legacy jira: where issue: is absent', () => {
    expect(storyIssueValue('', 'PROJ-1')).toBe('PROJ-1');
  });

  it('reads the template placeholder as absent', () => {
    expect(storyIssueValue('', '{JIRA_TICKET_URL}')).toBe('');
  });
});

describe('storyIssueLink', () => {
  it('reads an empty value as no issue', () => {
    expect(storyIssueLink('', github)).toEqual({ kind: 'none' });
  });

  it("accepts this repository's own GitHub issue page", () => {
    expect(storyIssueLink('https://github.com/plot-pm/plot/issues/3170', github)).toEqual({ kind: 'key', key: '3170' });
  });

  it('compares owner and repository without case and allows a trailing slash or fragment', () => {
    expect(storyIssueLink('https://github.com/Plot-PM/Plot/issues/3170/', github)).toEqual({ kind: 'key', key: '3170' });
    expect(storyIssueLink('https://github.com/plot-pm/plot/issues/3170#issuecomment-1', github)).toEqual({ kind: 'key', key: '3170' });
  });

  it("refuses another repository's issue on the same host", () => {
    expect(storyIssueLink('https://github.com/someone/else/issues/3170', github))
      .toEqual({ kind: 'unreadable', value: 'https://github.com/someone/else/issues/3170' });
  });

  it("accepts this repository's own Bitbucket issue page", () => {
    expect(storyIssueLink('https://bitbucket.org/quatico/site/issues/12', bitbucket)).toEqual({ kind: 'key', key: '12' });
  });

  it('accepts #<n>', () => {
    expect(storyIssueLink('#3170', github)).toEqual({ kind: 'key', key: '3170' });
  });

  it("reads a host link as unknown while the repository's address is unread", () => {
    expect(storyIssueLink('#3170', { issuePrefix: null, jiraProjects: [] })).toEqual({ kind: 'unknown' });
    expect(storyIssueLink('https://github.com/plot-pm/plot/issues/1', { issuePrefix: null, jiraProjects: [] })).toEqual({ kind: 'unknown' });
  });

  it('accepts a Jira key, bare or in a browse URL, only where its project is declared', () => {
    const jira: StoryIssueContext = { issuePrefix: null, jiraProjects: ['PROJ'] };
    expect(storyIssueLink('PROJ-12', jira)).toEqual({ kind: 'key', key: 'PROJ-12' });
    expect(storyIssueLink('https://acme.atlassian.net/browse/PROJ-12', jira)).toEqual({ kind: 'key', key: 'PROJ-12' });
    expect(storyIssueLink('OPS-1', jira)).toEqual({ kind: 'unreadable', value: 'OPS-1' });
    expect(storyIssueLink('PROJ-12', github)).toEqual({ kind: 'unreadable', value: 'PROJ-12' });
  });

  it('caps an unreadable value at 120 characters', () => {
    const link = storyIssueLink(`see ${'x'.repeat(200)}`, github);
    expect(link.kind === 'unreadable' && link.value.length).toBe(120);
  });

  it('reads a javascript: value as unreadable', () => {
    expect(storyIssueLink('javascript:alert(1)', github).kind).toBe('unreadable');
  });
});

describe('jiraProjectsOf', () => {
  it('reads the project keys after the URL', () => {
    expect(jiraProjectsOf('jira https://acme.atlassian.net PROJ, OPS')).toEqual(['PROJ', 'OPS']);
  });

  it('reads none where only the URL is declared, or for another scheme', () => {
    expect(jiraProjectsOf('jira https://acme.atlassian.net')).toEqual([]);
    expect(jiraProjectsOf('github-issues')).toEqual([]);
    expect(jiraProjectsOf('')).toEqual([]);
  });
});

describe('repoIssuePrefixOf', () => {
  it('reads the issue prefix from a GitHub or Bitbucket branch prefix', () => {
    expect(repoIssuePrefixOf('https://github.com/plot-pm/plot/tree/')).toBe('https://github.com/plot-pm/plot/issues/');
    expect(repoIssuePrefixOf('https://bitbucket.org/quatico/site/branch/')).toBe('https://bitbucket.org/quatico/site/issues/');
  });

  it('answers null for an unread or unknown prefix', () => {
    expect(repoIssuePrefixOf('')).toBeNull();
    expect(repoIssuePrefixOf('https://example.com/x/')).toBeNull();
  });
});

const story = (slug: string, issue: IndexedStory['issue'], over: Partial<IndexedStory> = {}): IndexedStory => ({
  slug, title: slug.toUpperCase(), status: 'draft', archived: false, issue, ...over,
});

describe('ticketStoryIndex', () => {
  it('links a ticket to the story whose issue: names it', () => {
    const index = ticketStoryIndex([story('nothing-runs', { kind: 'key', key: '3170' })], []);
    expect(index.get('3170')).toEqual([{ kind: 'story', slug: 'nothing-runs', title: 'NOTHING-RUNS', status: 'draft', archived: false }]);
  });

  it("links a ticket to the story its plan's Story: names", () => {
    const index = ticketStoryIndex([story('umbrella', { kind: 'none' })], [{ issues: ['#3102'], story: 'umbrella' }]);
    expect(index.get('3102')?.map((r) => r.kind === 'story' && r.slug)).toEqual(['umbrella']);
  });

  it('holds the union of both, each story once', () => {
    const index = ticketStoryIndex(
      [story('a', { kind: 'key', key: '7' }), story('b', { kind: 'none' })],
      [{ issues: ['7'], story: 'b' }, { issues: ['7'], story: 'a' }],
    );
    expect(index.get('7')?.map((r) => r.kind === 'story' && r.slug)).toEqual(['a', 'b']);
  });

  it('never indexes an unreadable or unknown link, nor a plan naming no committed story', () => {
    const index = ticketStoryIndex(
      [story('a', { kind: 'unreadable', value: 'https://github.com/x/y/issues/1' }), story('b', { kind: 'unknown' })],
      [{ issues: ['1'], story: 'uncommitted' }],
    );
    expect(index.size).toBe(0);
  });
});

describe('storyIsLive', () => {
  it('reads Draft as live and done, archived or unread as not', () => {
    expect(storyIsLive({ status: 'draft', archived: false })).toBe(true);
    expect(storyIsLive({ status: 'done', archived: false })).toBe(false);
    expect(storyIsLive({ status: 'active', archived: true })).toBe(false);
    expect(storyIsLive({ status: null, archived: false })).toBe(false);
  });
});
