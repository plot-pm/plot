import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { githubApi } from '../src/adapters/host/github-api.js';
import { githubIssueList } from '../src/adapters/host/github-issue-list.js';
import { githubPrListing } from '../src/adapters/host/github-pr-listing.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';
import { decodeEntry } from '../src/entities/budget.js';
import { startGithubReplay, type GithubReplay, type ReplayOverride } from './fixtures/github-replay.js';

const open: { replay: GithubReplay; home: string }[] = [];

afterEach(async () => {
  for (const one of open.splice(0)) {
    await one.replay.close();
    rmSync(one.home, { recursive: true, force: true });
  }
});

/** A client over a stub that answers every GraphQL body with `override`, and a reader of the ops its GraphQL budget rows record. */
const clientOver = async (override: ReplayOverride) => {
  const replay = await startGithubReplay([], override);
  const home = mkdtempSync(join(tmpdir(), 'plot-graphql-op-'));
  open.push({ replay, home });
  const api = githubApi({
    origin: 'git@github.com:plot-fixture/listing.git',
    env: { GITHUB_API_URL: replay.url, GH_TOKEN: 'fixture' },
    budget: budgetFile({ home }),
    slots: slotsFile({ home, isAlive: () => true }),
  });
  const ops = (): (string | undefined)[] =>
    readFileSync(join(home, 'budget.tsv'), 'utf8')
      .split('\n')
      .map(decodeEntry)
      .filter((entry) => entry !== null)
      .map((entry) => entry.op)
      .filter((op) => op !== 'user');
  return { api, ops };
};

/** The search-type introspection answer, or `page` for every other body. */
const answering = (page: unknown): ReplayOverride => (body) =>
  JSON.stringify(body).includes('SearchType_enumValues')
    ? { status: 200, body: { data: { SearchType: { enumValues: [{ name: 'ISSUE' }] } } } }
    : { status: 200, body: page };

const EMPTY_PAGE = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };

describe('a GraphQL budget row names its query', () => {
  it('a repository pull request listing records pr-list-<state>-graphql', async () => {
    const { api, ops } = await clientOver(answering({ data: { repository: { pullRequests: EMPTY_PAGE } } }));
    await githubPrListing(api).prListing({ state: 'merged', limit: 10 });
    expect(ops()).toEqual(['pr-list-merged-graphql']);
  });

  it('a windowed pull request listing records the search type and pr-list-<state>-since-graphql', async () => {
    const { api, ops } = await clientOver(answering({ data: { search: EMPTY_PAGE } }));
    await githubPrListing(api).prListing({ state: 'all', limit: 10, since: '2026-11-01T00:00:00Z' });
    expect(ops()).toEqual(['pr-list-search-types', 'pr-list-all-since-graphql']);
  });

  it('an open issue listing records issue-list-open-graphql', async () => {
    const { api, ops } = await clientOver(answering({ data: { repository: { hasIssuesEnabled: true, issues: EMPTY_PAGE } } }));
    await githubIssueList(api).list({ state: 'open' }, 10);
    expect(ops()).toEqual(['issue-list-open-graphql']);
  });

  it('a changed issue listing records the search type and issue-list-changed-graphql', async () => {
    const { api, ops } = await clientOver(answering({ data: { repository: { hasIssuesEnabled: true }, search: EMPTY_PAGE } }));
    await githubIssueList(api).list({ state: 'changed', since: '2026-11-01T00:00:00Z' }, 10);
    expect(ops()).toEqual(['issue-list-search-types', 'issue-list-changed-graphql']);
  });
});
