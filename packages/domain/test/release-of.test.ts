import { describe, expect, it } from 'vitest';

import type { IssueIndexRow } from '../src/entities/issue-index.js';
import { releaseOf } from '../src/rules/release-of.js';

const row = (releases?: string[]): IssueIndexRow => ({
  number: '1',
  title: 't',
  url: 'u',
  ...(releases === undefined ? {} : { releases }),
});

describe('releaseOf', () => {
  it('matches either of two Jira fix versions', () => {
    expect(releaseOf(row(['2.32.0', '2.33.0']), '2.32.0')).toBe(true);
    expect(releaseOf(row(['2.32.0', '2.33.0']), '2.33.0')).toBe(true);
  });

  it('matches a GitHub milestone as a one-element list', () => {
    expect(releaseOf(row(['2.32.0']), '2.32.0')).toBe(true);
  });

  it('compares names exactly: 2.32 is not 2.32.0', () => {
    expect(releaseOf(row(['2.32.0']), '2.32')).toBe(false);
    expect(releaseOf(row(['2.32']), '2.32.0')).toBe(false);
  });

  it('answers false for an empty list and for an absent field, which stay distinguishable on the row', () => {
    expect(releaseOf(row([]), '2.32.0')).toBe(false);
    expect(releaseOf(row(), '2.32.0')).toBe(false);
    expect(row([]).releases).toEqual([]);
    expect(row().releases).toBeUndefined();
  });
});
