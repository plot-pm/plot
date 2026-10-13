import { describe, it, expect } from 'vitest';
import { pageOf } from '../src/adapters/tracker/tracker-shell.js';

// Every issue read goes through `pageOf`. A line with no `number` is not an
// issue: PR #1653's review measured a Jira page token line,
// `{"nextPageToken":"more"}`, reaching *Waiting on you* as `#undefined`.

const row = (number: string | number): string =>
  JSON.stringify({ number, title: `issue ${number}`, url: `https://example.invalid/${number}`, createdAt: '2026-10-01T00:00:00Z', status: 'Open', statusCategory: 'To Do' });

describe('pageOf', () => {
  it('takes a page token line as the next token and keeps the issues around it', () => {
    const page = pageOf([row('PROJ-1'), '{"nextPageToken":"more"}', row(7), ''].join('\n'));
    expect(page.issues.map((issue) => issue.id)).toEqual(['PROJ-1', '7']);
    expect(page.issues.some((issue) => issue.id === 'undefined')).toBe(false);
    expect(page.next).toBe('more');
  });

  it('answers no next token on a page that printed none', () => {
    expect(pageOf(row(3)).next).toBeNull();
  });
});
