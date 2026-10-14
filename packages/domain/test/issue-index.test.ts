import { describe, expect, it } from 'vitest';

import {
  decodeIssueIndex,
  encodeIssueIndex,
  ISSUE_INDEX_VERSION,
  type IssueIndex,
} from '../src/entities/issue-index.js';

const store = (overrides: Partial<IssueIndex> = {}): IssueIndex => ({
  v: ISSUE_INDEX_VERSION,
  source: 'tracker',
  connector: 'github',
  account: 'acct',
  requests: 1,
  nextAt: 1_000,
  backoffUntil: null,
  at: '2026-10-13T00:00:00.000Z',
  answer: 'answered',
  rows: [{ number: '1', title: 'A title', url: 'https://example.test/1' }],
  complete: true,
  ...overrides,
});

describe('the encoding round-trips', () => {
  it('reads back exactly what it wrote', () => {
    const original = store();
    expect(decodeIssueIndex(encodeIssueIndex(original))).toEqual(original);
  });

  it('writes pretty-printed JSON terminated by a newline', () => {
    const text = encodeIssueIndex(store());
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  ');
  });

  it('round-trips a store with no account, as a connector with no budget key writes it', () => {
    const original = store({ account: undefined });
    const back = decodeIssueIndex(encodeIssueIndex(original));
    expect(back).not.toHaveProperty('account');
  });

  it('round-trips a failed pass carrying failedAt and reason, with no rows yet', () => {
    const original = store({
      answer: 'failed',
      failedAt: '2026-10-13T00:01:00.000Z',
      reason: 'host unreachable',
      rows: undefined,
      complete: undefined,
    });
    expect(decodeIssueIndex(encodeIssueIndex(original))).toEqual(original);
  });
});

describe('an unreadable store is nothing to start from', () => {
  it('returns null rather than throwing on every unreadable shape', () => {
    expect(() => decodeIssueIndex('{not json')).not.toThrow();
    expect(decodeIssueIndex('{not json')).toBeNull();
    expect(decodeIssueIndex('')).toBeNull();
    expect(decodeIssueIndex('   ')).toBeNull();
    expect(decodeIssueIndex('{"hello":"world"}')).toBeNull();
  });

  it('refuses a version it does not recognise', () => {
    expect(decodeIssueIndex(JSON.stringify({ ...store(), v: 2 }))).toBeNull();
  });

  it('refuses a row whose shape does not match', () => {
    const malformed = { ...store(), rows: [{ number: 1 }] };
    expect(decodeIssueIndex(JSON.stringify(malformed))).toBeNull();
  });

  it('refuses an object carrying a key the schema does not name', () => {
    const extra = JSON.stringify({ ...store(), somethingElse: true });
    expect(decodeIssueIndex(extra)).toBeNull();
  });
});

describe('a row with assignees', () => {
  it('decodes a row that carries assignees and one that does not, at the same version', () => {
    const withAssignees = store({
      rows: [{ number: '1', title: 'A title', url: 'https://example.test/1', assignees: ['alice', 'bob'] }],
    });
    const withoutAssignees = store();
    expect(decodeIssueIndex(encodeIssueIndex(withAssignees))).toEqual(withAssignees);
    expect(decodeIssueIndex(encodeIssueIndex(withoutAssignees))).toEqual(withoutAssignees);
  });
});

describe('the closed set', () => {
  const closed = {
    since: '2026-09-29T00:00:00.000Z',
    at: '2026-10-13T00:00:00.000Z',
    answer: 'answered' as const,
    rows: [{ number: '2', title: 'Done', url: 'https://example.test/2', closedAt: '2026-10-12T00:00:00Z' }],
    complete: false,
  };

  it('round-trips a closed block', () => {
    const original = store({ closed });
    expect(decodeIssueIndex(encodeIssueIndex(original))).toEqual(original);
  });

  it('decodes a file with no closed block as "not read", without inventing one', () => {
    expect(decodeIssueIndex(encodeIssueIndex(store()))).not.toHaveProperty('closed');
  });

  it('refuses a closed block with an unknown answer', () => {
    expect(decodeIssueIndex(JSON.stringify({ ...store(), closed: { ...closed, answer: 'maybe' } }))).toBeNull();
  });
});

describe('the inbox set', () => {
  const inboxRows = [{ number: '3', title: 'My ticket', url: 'https://example.test/3' }];

  it('round-trips an inbox block', () => {
    const original = store({ inbox: inboxRows });
    expect(decodeIssueIndex(encodeIssueIndex(original))).toEqual(original);
  });

  it('decodes a file with no inbox block as "no inbox read happened", without inventing one', () => {
    expect(decodeIssueIndex(encodeIssueIndex(store()))).not.toHaveProperty('inbox');
  });

  it('keeps inbox: [] distinct from inbox absent — an empty inbox is a read that found nothing', () => {
    const empty = store({ inbox: [] });
    const absent = store();
    const decodedEmpty = decodeIssueIndex(encodeIssueIndex(empty));
    const decodedAbsent = decodeIssueIndex(encodeIssueIndex(absent));
    expect(decodedEmpty).toHaveProperty('inbox', []);
    expect(decodedAbsent).not.toHaveProperty('inbox');
    expect(decodedEmpty).not.toEqual(decodedAbsent);
  });
});
