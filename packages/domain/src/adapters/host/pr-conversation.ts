import { answered, failed, type PortResult } from '../../port-result.js';
import type { Host, HostRefusal, PrConversationReading, PrConversationRow } from '../../ports/host.js';
import { bitbucketConversation } from '../../rules/bitbucket-pr-reading.js';
import type { BitbucketApi } from './bitbucket-api.js';
import type { GithubApi } from './github-api.js';

/** The rows one GitHub REST page holds at most. */
const PAGE_ROWS = 100;

/** The pages one endpoint may hold; a conversation past it reads as failed rather than short. */
const PAGE_CAP = 100;

/** An in-process conversation read. */
export interface PrConversationReader {
  /** Reads a PR's whole conversation; see {@link Host.prConversation}. Never rejects. */
  prConversation(number: number): Promise<PortResult<PrConversationReading>>;
  /** The refusal behind the last `failed` answer, or null. */
  lastRefusal(): HostRefusal | null;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The in-process GitHub conversation read: REST only, every page.
 *
 * It reads `pulls/<n>` for the author's login, then every page of
 * `issues/<n>/comments`, `pulls/<n>/comments` and `pulls/<n>/reviews` with
 * `per_page=100`. A refused request, a body that is not a list, a missing
 * origin slug or a conversation past the page cap is `failed`, never a short
 * list. A deleted account reads `''` for login and type. A comment's time is
 * `created_at` and a review's `submitted_at` (`''` while pending).
 *
 * @param api - the in-process GitHub client.
 * @returns the reader.
 */
export const githubPrConversation = (api: GithubApi): PrConversationReader => {
  let refusal: HostRefusal | null = null;
  const refuse = (said: string): PortResult<PrConversationReading> => {
    refusal = { kind: 'failed', said };
    return failed();
  };
  return {
    lastRefusal: () => refusal,
    prConversation: async (number) => {
      refusal = null;
      const slug = api.origin.slug;
      if (slug === null) return refuse('the origin remote names no GitHub owner/repo');
      const pull = await api.request({ method: 'GET', path: `/repos/${slug}/pulls/${number}`, label: `pr ${number}` });
      if (!pull.ok) {
        refusal = pull.refusal;
        return failed();
      }
      const prAuthor = text(record(record(pull.reply.body).user).login);
      const rows: PrConversationRow[] = [];
      const kinds = [
        { kind: 'issue', path: `issues/${number}/comments` },
        { kind: 'inline', path: `pulls/${number}/comments` },
        { kind: 'review', path: `pulls/${number}/reviews` },
      ] as const;
      for (const { kind, path } of kinds) {
        for (let page = 1; ; page += 1) {
          if (page > PAGE_CAP) return refuse(`${path} holds more than ${PAGE_CAP} pages`);
          const asked = await api.request({ method: 'GET', path: `/repos/${slug}/${path}?per_page=${PAGE_ROWS}&page=${page}`, label: `${path}, page ${page}` });
          if (!asked.ok) {
            refusal = asked.refusal;
            return failed();
          }
          if (!Array.isArray(asked.reply.body)) return refuse(`${path}, page ${page}, is not a list`);
          for (const item of asked.reply.body) {
            const c = record(item);
            const user = record(c.user);
            rows.push({
              kind,
              id: typeof c.id === 'number' ? c.id : 0,
              login: text(user.login),
              type: text(user.type),
              time: kind === 'review' ? text(c.submitted_at) : text(c.created_at),
              body: text(c.body),
              ...(kind === 'review' ? { state: text(c.state) } : {}),
            });
          }
          if (asked.reply.body.length < PAGE_ROWS) break;
        }
      }
      return answered({ prAuthor, rows });
    },
  };
};

/**
 * The in-process Bitbucket conversation read: the PR, then every comment page
 * through its `next` links, folded by {@link bitbucketConversation}.
 *
 * @param api - the in-process Bitbucket client.
 * @returns the reader.
 */
export const bitbucketPrConversation = (api: BitbucketApi): PrConversationReader => {
  let refusal: HostRefusal | null = null;
  return {
    lastRefusal: () => refusal,
    prConversation: async (number) => {
      refusal = null;
      const pr = `/repositories/{ws}/{repo}/pullrequests/${number}`;
      const head = await api.request({ method: 'GET', path: pr, label: `pr ${number}` });
      if (!head.ok) {
        refusal = head.refusal;
        return failed();
      }
      const comments: unknown[] = [];
      let path = `${pr}/comments?pagelen=100`;
      for (let page = 1; path !== ''; page += 1) {
        if (page > PAGE_CAP) {
          refusal = { kind: 'failed', said: `comments of pr ${number} hold more than ${PAGE_CAP} pages` };
          return failed();
        }
        const asked = await api.request({ method: 'GET', path, label: `pr ${number} comments, page ${page}` });
        if (!asked.ok) {
          refusal = asked.refusal;
          return failed();
        }
        const body = record(asked.reply.body);
        if (!Array.isArray(body.values)) {
          refusal = { kind: 'failed', said: `comments of pr ${number}, page ${page}, hold no values list` };
          return failed();
        }
        comments.push(...body.values);
        const link = text(body.next);
        if (link === '') break;
        const next = api.nextPath(link);
        if (!next.ok) {
          refusal = next.refusal;
          return failed();
        }
        path = next.path;
      }
      return answered(bitbucketConversation(record(head.reply.body), comments as Parameters<typeof bitbucketConversation>[1]));
    },
  };
};

/**
 * The `Host` with `prConversation` answered by an in-process reader.
 *
 * `lastRefusal` reports the reader's refusal after a conversation read and the
 * host's after any other call.
 *
 * @param host - the composed `Host`.
 * @param reader - the in-process reader.
 * @returns the `Host` with the read replaced.
 */
export const hostWithConversation = (host: Host, reader: PrConversationReader): Host => {
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
    prConversation: (number) => {
      read = true;
      return reader.prConversation(number);
    },
    lastRefusal: () => (read ? reader.lastRefusal() : host.lastRefusal()),
  };
};
