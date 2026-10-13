import { describe, it, expect } from 'vitest';
import { openIssuesOf } from '../../src/server/fleet.js';

// The no-fleet inbox reads `plot-host.sh issue-list` line by line. A line with
// no `number` is not an issue: PR #1653's review measured a Jira page token
// line, `{"nextPageToken":"more"}`, reaching *Waiting on you* as `#undefined`.

const row = (number: string | number): string =>
  JSON.stringify({ number, title: `issue ${number}`, url: `https://example.invalid/${number}`, createdAt: '2026-10-01T00:00:00Z', status: 'Open', statusCategory: 'To Do' });

describe('openIssuesOf', () => {
  it('skips a page token line and keeps the issues around it', () => {
    const issues = openIssuesOf([row('PROJ-1'), '{"nextPageToken":"more"}', row(7), ''].join('\n'));
    expect(issues.map((issue) => issue.number)).toEqual(['PROJ-1', '7']);
    expect(issues.some((issue) => issue.number === 'undefined')).toBe(false);
  });

  it('skips a line whose number is null or empty, and a line that does not parse', () => {
    const lines = [JSON.stringify({ number: null, title: 'x' }), JSON.stringify({ number: '', title: 'y' }), 'not json', row(3)];
    expect(openIssuesOf(lines.join('\n'))).toEqual([
      { number: '3', title: 'issue 3', url: 'https://example.invalid/3', createdAt: '2026-10-01T00:00:00Z', status: 'Open', statusCategory: 'To Do' },
    ]);
  });
});
