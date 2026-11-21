import type { Pr, PrState } from '../../entities/pr.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type { Host, HostRefusal } from '../../ports/host.js';
import type { BitbucketApi } from './bitbucket-api.js';
import type { GithubApi } from './github-api.js';

/** The rows one GitHub REST page holds at most. */
const PAGE_ROWS = 100;

/** The pages one commit's PR list may hold; a list past it reads as failed rather than short. */
const PAGE_CAP = 20;

/** An in-process read of the PRs a commit belongs to. */
export interface PrsOfCommitReader {
  /** Reads the PRs of one commit; see {@link Host.prsOfCommit}. Never rejects. */
  prsOfCommit(sha: string): Promise<PortResult<readonly Pr[]>>;
  /** The refusal behind the last `failed` answer, or null. */
  lastRefusal(): HostRefusal | null;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The fields neither endpoint carries, as `pr-list --rich-open` emits them for a terminal row. */
const NOT_ASKED = { mergeable: 'unknown', checks: 'unknown', review: '', failingChecks: [] } as const;

/**
 * One GitHub `commits/<sha>/pulls` row as a `Pr`, or null where its state word is unknown.
 *
 * GitHub reports a merged PR as `closed`: a `closed` row with a `merged_at`
 * reads `MERGED`, one without reads `CLOSED`.
 */
const githubRow = (item: unknown): Pr | null => {
  const row = record(item);
  const mergedAt = text(row.merged_at);
  const state: PrState | null =
    row.state === 'open' ? 'OPEN' : row.state === 'closed' ? (mergedAt === '' ? 'CLOSED' : 'MERGED') : null;
  if (state === null || typeof row.number !== 'number') return null;
  const head = record(row.head);
  return {
    number: row.number,
    repo: '',
    head: text(head.ref),
    headSha: text(head.sha),
    base: text(record(row.base).ref),
    state,
    mergedAt: state === 'MERGED' ? mergedAt : null,
    mergeCommit: state === 'MERGED' ? text(row.merge_commit_sha) : '',
    draft: row.draft === true,
    url: text(row.html_url),
    author: text(record(row.user).login),
    ...NOT_ASKED,
  };
};

const BITBUCKET_STATE: Readonly<Record<string, PrState>> = { OPEN: 'OPEN', MERGED: 'MERGED', DECLINED: 'CLOSED', SUPERSEDED: 'CLOSED' };

/**
 * One Bitbucket `commit/<sha>/pullrequests` row as a `Pr`, or null where its state word is unknown.
 *
 * `mergedAt` is `updated_on`, the stand-in `bitbucketPrState` reads, because
 * the endpoint names no merge time.
 */
const bitbucketRow = (item: unknown): Pr | null => {
  const row = record(item);
  const state = BITBUCKET_STATE[text(row.state)];
  if (state === undefined || typeof row.id !== 'number') return null;
  const source = record(row.source);
  return {
    number: row.id,
    repo: '',
    head: text(record(source.branch).name),
    headSha: text(record(source.commit).hash),
    base: text(record(record(row.destination).branch).name),
    state,
    mergedAt: state === 'MERGED' ? text(row.updated_on) : null,
    mergeCommit: state === 'MERGED' ? text(record(row.merge_commit).hash) : '',
    draft: row.draft === true,
    url: text(record(record(row.links).html).href),
    author: text(record(row.author).nickname),
    ...NOT_ASKED,
  };
};

/**
 * Maps every row, or names the first one it cannot read.
 *
 * @returns the PRs, or the reason a row did not map.
 */
const mapped = (items: readonly unknown[], row: (item: unknown) => Pr | null, where: string): { prs: Pr[] } | { said: string } => {
  const prs: Pr[] = [];
  for (const item of items) {
    const pr = row(item);
    if (pr === null) return { said: `${where} holds a row with no number or an unknown state` };
    prs.push(pr);
  }
  return { prs };
};

/**
 * The in-process GitHub read of a commit's PRs: `GET /repos/<slug>/commits/<sha>/pulls`.
 *
 * It reads every page with `per_page=100`. A refused request, a body that is
 * not a list, a row it cannot map, a missing origin slug or a list past the
 * page cap is `failed`, never a short list. An empty list from a reachable
 * host answers `[]`.
 *
 * @param api - the in-process GitHub client.
 * @returns the reader.
 */
export const githubPrsOfCommit = (api: GithubApi): PrsOfCommitReader => {
  let refusal: HostRefusal | null = null;
  const refuse = (said: string): PortResult<readonly Pr[]> => {
    refusal = { kind: 'failed', said };
    return failed();
  };
  return {
    lastRefusal: () => refusal,
    prsOfCommit: async (sha) => {
      refusal = null;
      const slug = api.origin.slug;
      if (slug === null) return refuse('the origin remote names no GitHub owner/repo');
      const prs: Pr[] = [];
      for (let page = 1; ; page += 1) {
        if (page > PAGE_CAP) return refuse(`the PRs of commit ${sha} hold more than ${PAGE_CAP} pages`);
        const asked = await api.request({
          method: 'GET',
          path: `/repos/${slug}/commits/${sha}/pulls?per_page=${PAGE_ROWS}&page=${page}`,
          label: `PRs of commit ${sha}, page ${page}`,
        });
        if (!asked.ok) {
          refusal = asked.refusal;
          return failed();
        }
        const body = asked.reply.body;
        if (!Array.isArray(body)) return refuse(`the PRs of commit ${sha}, page ${page}, are not a list`);
        const rows = mapped(body, githubRow, `the PRs of commit ${sha}, page ${page},`);
        if ('said' in rows) return refuse(rows.said);
        prs.push(...rows.prs);
        if (body.length < PAGE_ROWS) break;
      }
      return answered(prs);
    },
  };
};

/**
 * The in-process Bitbucket read of a commit's PRs:
 * `GET /repositories/{ws}/{repo}/commit/<sha>/pullrequests`, every page through
 * its `next` links.
 *
 * Bitbucket answers only once it has indexed the repository's commit links:
 * HTTP 202 (indexing started) and HTTP 404 (not indexed, or no such commit)
 * each answer `unaskable` with the reason, never `[]`. Any other refused
 * request, a body with no `values` list, a row it cannot map or a list past
 * the page cap is `failed`.
 *
 * @param api - the in-process Bitbucket client.
 * @returns the reader.
 */
export const bitbucketPrsOfCommit = (api: BitbucketApi): PrsOfCommitReader => {
  let refusal: HostRefusal | null = null;
  const refuse = (said: string): PortResult<readonly Pr[]> => {
    refusal = { kind: 'failed', said };
    return failed();
  };
  return {
    lastRefusal: () => refusal,
    prsOfCommit: async (sha) => {
      refusal = null;
      const prs: Pr[] = [];
      let path = `/repositories/{ws}/{repo}/commit/${sha}/pullrequests?pagelen=50`;
      for (let page = 1; path !== ''; page += 1) {
        if (page > PAGE_CAP) return refuse(`the PRs of commit ${sha} hold more than ${PAGE_CAP} pages`);
        const asked = await api.request({ method: 'GET', path, label: `PRs of commit ${sha}, page ${page}` });
        const status = asked.reply?.status;
        if (status === 202) return unaskable(`Bitbucket answered HTTP 202 for commit ${sha}: it is indexing the repository's commit links`);
        if (status === 404) return unaskable(`Bitbucket answered HTTP 404 for commit ${sha}: its commit links are not indexed, or it holds no such commit`);
        if (!asked.ok) {
          refusal = asked.refusal;
          return failed();
        }
        const body = record(asked.reply.body);
        if (!Array.isArray(body.values)) return refuse(`the PRs of commit ${sha}, page ${page}, hold no values list`);
        const rows = mapped(body.values, bitbucketRow, `the PRs of commit ${sha}, page ${page},`);
        if ('said' in rows) return refuse(rows.said);
        prs.push(...rows.prs);
        const link = text(body.next);
        if (link === '') break;
        const next = api.nextPath(link);
        if (!next.ok) {
          refusal = next.refusal;
          return failed();
        }
        path = next.path;
      }
      return answered(prs);
    },
  };
};

/**
 * The `Host` with `prsOfCommit` answered by an in-process reader.
 *
 * `lastRefusal` reports the reader's refusal after a `prsOfCommit` call and
 * the host's after any other call.
 *
 * @param host - the composed `Host`.
 * @param reader - the in-process reader.
 * @returns the `Host` with the read replaced.
 */
export const hostWithPrsOfCommit = (host: Host, reader: PrsOfCommitReader): Host => {
  let read = false;
  const composed: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(host)) {
    composed[name] =
      typeof member === 'function'
        ? (...args: unknown[]): unknown => {
            read = false;
            return (member as (...a: unknown[]) => unknown)(...args);
          }
        : member;
  }
  return {
    ...(composed as unknown as Host),
    prsOfCommit: (sha) => {
      read = true;
      return reader.prsOfCommit(sha);
    },
    lastRefusal: () => (read ? reader.lastRefusal() : host.lastRefusal()),
  };
};
