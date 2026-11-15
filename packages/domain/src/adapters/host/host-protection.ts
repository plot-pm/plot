import { answered, failed } from '../../port-result.js';
import type { PortResult } from '../../port-result.js';
import type { HostRefusal } from '../../ports/host.js';
import type { BitbucketApi } from './bitbucket-api.js';
import type { GithubApi } from './github-api.js';

/** The in-process read of the restrictions a host holds on one branch. */
export interface HostProtection {
  /** The restriction words on a branch, `[]` where the host answered and holds none; `failed` where it did not answer. */
  branchRestrictions(branch: string): Promise<PortResult<readonly string[]>>;
  /** The refusal of the last call, or null where it answered. */
  lastRefusal(): HostRefusal | null;
}

/** The pages a restriction walk reads before it refuses. */
const PAGE_CAP = 20;

/** A value read as an object, or an empty one. */
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Reads whether a GitHub branch is protected, over `GET /repos/{slug}/branches/{branch}`.
 *
 * An answer whose `protected` is not a boolean, a repository with no slug and a
 * refused request each read `failed`; none reads as an empty list.
 *
 * @param api - the in-process GitHub client.
 * @returns the reader; `['protected']` where the branch is protected, `[]` where it is not.
 */
export const githubProtection = (api: GithubApi): HostProtection => {
  let refusal: HostRefusal | null = null;
  return {
    branchRestrictions: async (branch) => {
      refusal = null;
      const slug = api.origin.slug;
      if (slug === null) return failed();
      const answer = await api.request({ method: 'GET', path: `/repos/${slug}/branches/${encodeURIComponent(branch)}`, label: 'default-branch-protection' });
      if (!answer.ok) {
        refusal = answer.refusal;
        return failed();
      }
      const flag = record(answer.reply.body).protected;
      return typeof flag === 'boolean' ? answered(flag ? ['protected'] : []) : failed();
    },
    lastRefusal: () => refusal,
  };
};

/**
 * Reads the restriction kinds on a Bitbucket branch, over
 * `GET /repositories/{ws}/{repo}/branch-restrictions`.
 *
 * A restriction counts where its pattern is the branch, or where it matches the
 * production branch of the branching model. A 403 (a token without the scope), a
 * refused page and a walk longer than {@link PAGE_CAP} pages each read `failed`:
 * a restriction on a page not read would otherwise read as none.
 *
 * @param api - the in-process Bitbucket client.
 * @returns the reader; the unique kinds found, `[]` where the host holds none.
 */
export const bitbucketProtection = (api: BitbucketApi): HostProtection => {
  let refusal: HostRefusal | null = null;
  return {
    branchRestrictions: async (branch) => {
      refusal = null;
      const kinds = new Set<string>();
      let path = '/repositories/{ws}/{repo}/branch-restrictions?pagelen=100';
      for (let page = 1; page <= PAGE_CAP; page++) {
        const answer = await api.request({ method: 'GET', path, label: `default-branch-protection, page ${page}` });
        if (!answer.ok) {
          refusal = answer.refusal;
          return failed();
        }
        const body = record(answer.reply.body);
        if (!Array.isArray(body.values)) return failed();
        for (const value of body.values) {
          const entry = record(value);
          const onBranch = entry.pattern === branch || (entry.branch_match_kind === 'branching_model' && entry.branch_type === 'production');
          if (onBranch && typeof entry.kind === 'string') kinds.add(entry.kind);
        }
        if (typeof body.next !== 'string' || body.next === '') return answered([...kinds].sort());
        const next = api.nextPath(body.next);
        if (!next.ok) {
          refusal = next.refusal;
          return failed();
        }
        path = next.path;
      }
      return failed();
    },
    lastRefusal: () => refusal,
  };
};
