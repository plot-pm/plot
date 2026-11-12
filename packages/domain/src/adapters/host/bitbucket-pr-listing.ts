import type { HostRefusal, PrListing, PrListingCompleteness, PrListingQuery, PrListingRow } from '../../ports/host.js';
import type { Refs } from '../../ports/refs.js';
import { bitbucketPlainRow, bitbucketRichRow, type BitbucketPrRow, type BitbucketPullRequest } from '../../rules/bitbucket-pr-row.js';
import { bitbucketMergeable, type MergeableReading } from '../../rules/bitbucket-mergeable.js';
import { listingWords, pagePossiblyTruncated, sweepComplete, walkStep, type ListedPage } from '../../rules/listing-page.js';
import type { BitbucketApi } from './bitbucket-api.js';
import { BITBUCKET_REQUEST_PAGELEN, envelopeNextFor } from './listing-paging.js';

/** The pages a branch query reads before it refuses (`BB_BRANCH_QUERY_PAGE_CAP`). */
export const BITBUCKET_BRANCH_QUERY_PAGE_CAP = 20;

/** The `git --version` text the mergeability reading is given: `Refs.conflictPaths` answers a git older than 2.38 as a failure, so the version check is the port's. */
const PORT_GIT_VERSION = 'git version 2.38.0';

/** The states `--state` names, in the order `plot-host.sh` asks them. */
const STATES: Readonly<Record<string, readonly string[]>> = {
  open: ['open'],
  merged: ['merged'],
  all: ['open', 'merged', 'declined'],
};

/**
 * The in-process Bitbucket PR listing: answers {@link Host.prListing} over the
 * Bitbucket Cloud REST API with the requests `plot-host.sh pr-list` sends
 * through `bb api`.
 */
export interface BitbucketPrListing {
  /** Lists pull requests; see {@link Host.prListing}. Never rejects. */
  prListing(query: PrListingQuery): Promise<PrListing>;
  /** The refusal of the last call, or null where it answered in full. */
  lastRefusal(): HostRefusal | null;
}

/** What one state's read answered. */
interface StateRead {
  /** The pull requests read, as Bitbucket exports them. */
  readonly prs: readonly BitbucketPullRequest[];
  /** What the read claims about the state: whole, doubted, or nothing. */
  readonly claim: 'whole' | 'doubted' | 'none';
  /** Why the read stopped early, or null. */
  readonly refusal: HostRefusal | null;
  /** How many pages answered. */
  readonly pages: number;
}

/** A value read as an object, or an empty one. */
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The `values` of a page, as exported pull requests. */
const valuesOf = (body: unknown): readonly BitbucketPullRequest[] => {
  const values = record(body).values;
  return Array.isArray(values) ? (values as readonly BitbucketPullRequest[]) : [];
};

/** The `next` link of a page, or `''` where it names none. */
const nextOf = (body: unknown): string => {
  const next = record(body).next;
  return typeof next === 'string' ? next : '';
};

/**
 * Percent-encodes one query value as `plot-host.sh`'s `url_encode` does:
 * every byte outside `[a-zA-Z0-9.~_-]` becomes `%XX`.
 */
const urlEncode = (raw: string): string =>
  [...Buffer.from(raw, 'utf8')]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[a-zA-Z0-9.~_-]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');

/** The path of a plain state listing: `pullrequests?state=<S>&pagelen=50`. */
const statePath = (state: string): string =>
  `/repositories/{ws}/{repo}/pullrequests?state=${state.toUpperCase()}&pagelen=${BITBUCKET_REQUEST_PAGELEN}`;

/**
 * The path of a `q=` query: the state clause, an optional branch clause and an
 * optional `updated_on>=` window clause joined by `AND`, spaces as `%20`.
 */
const queryPath = (state: string, branch: string | null, since: string | undefined): string => {
  let q = `state=${urlEncode(`"${state.toUpperCase()}"`)}`;
  if (branch !== null) q += ` AND source.branch.name=${urlEncode(`"${branch}"`)}`;
  if (since !== undefined) q += ` AND updated_on>=${urlEncode(`"${since}"`)}`;
  return `/repositories/{ws}/{repo}/pullrequests?q=${q.replaceAll(' ', '%20')}&pagelen=${BITBUCKET_REQUEST_PAGELEN}`;
};

/**
 * Builds the in-process Bitbucket PR listing over one client and one `Refs`.
 *
 * Each state is asked as `plot-host.sh` asks it: a plain listing walks `next`
 * up to the limit (50 where none is given), a window (`since`) reads every
 * page and refuses a read that holds fewer distinct rows than the server's
 * `size`, and a sweep (`branches`) asks each branch and state once and reads
 * up to {@link BITBUCKET_BRANCH_QUERY_PAGE_CAP} pages. A `next` link outside
 * the API base is a refusal. `all` asks open, merged and declined.
 *
 * Completeness follows the shell: a plain state is `whole` only where a limit
 * was given and the walk saw the end; a window state is `whole` after a full
 * read; a sweep claims no state and is `whole` for the asked state where every
 * state answered. A refusal answers the rows read so far, `possibly-truncated`
 * for every state of the call, the refusal, and `partial`; a refusal before
 * any page answered is `failed` with no rows.
 *
 * An open row's `mergeable` is read through `refs` over `origin/<base>`, as
 * the scan's fetch left it, and cached in memory by head and base SHA. A base
 * ref the clone does not hold reads `unknown` with its reason.
 *
 * @param api - the in-process Bitbucket client.
 * @param refs - the clone the mergeability reading runs against.
 * @returns the listing.
 */
export const bitbucketPrListing = (api: BitbucketApi, refs: Pick<Refs, 'resolve' | 'conflictPaths'>): BitbucketPrListing => {
  let refusal: HostRefusal | null = null;
  const merges = new Map<string, MergeableReading>();

  const fetchPage = async (path: string, label: string) => api.request({ method: 'GET', path, label });

  const plainState = async (state: string, query: PrListingQuery): Promise<StateRead> => {
    const limit = query.limit ?? BITBUCKET_REQUEST_PAGELEN;
    const prs: BitbucketPullRequest[] = [];
    const pages: ListedPage[] = [];
    let path = statePath(state);
    for (;;) {
      const answer = await fetchPage(path, `pr-list state=${state.toUpperCase()}, page ${pages.length + 1}`);
      if (!answer.ok) return { prs: prs.slice(0, limit), claim: 'doubted', refusal: answer.refusal, pages: pages.length };
      const values = valuesOf(answer.reply.body);
      prs.push(...values);
      pages.push({ rows: values.length, envelopeNext: envelopeNextFor(answer.reply.body) });
      const step = walkStep(pages, limit, BITBUCKET_REQUEST_PAGELEN);
      if (step.stops) {
        const rows = Math.min(prs.length, limit);
        const claim = query.limit === undefined || (rows <= 0 && step.envelopeNext !== 'present')
          ? 'none'
          : pagePossiblyTruncated({ limit, rows, paging: { kind: 'fixed-page', pageLength: BITBUCKET_REQUEST_PAGELEN }, envelopeNext: step.envelopeNext })
            ? 'doubted'
            : 'whole';
        return { prs: prs.slice(0, limit), claim, refusal: null, pages: pages.length };
      }
      const next = api.nextPath(nextOf(answer.reply.body));
      if (!next.ok) return { prs: prs.slice(0, limit), claim: 'doubted', refusal: next.refusal, pages: pages.length };
      path = next.path;
    }
  };

  const windowState = async (state: string, since: string): Promise<StateRead> => {
    const rows: BitbucketPullRequest[] = [];
    let size = 0;
    let pages = 0;
    let path = queryPath(state, null, since);
    while (path !== '') {
      const answer = await fetchPage(path, `pr-list state=${state.toUpperCase()} window, page ${pages + 1}`);
      if (!answer.ok) return { prs: distinct(rows), claim: 'doubted', refusal: answer.refusal, pages };
      pages += 1;
      rows.push(...valuesOf(answer.reply.body));
      const reported = record(answer.reply.body).size;
      size = typeof reported === 'number' ? reported : 0;
      const link = nextOf(answer.reply.body);
      if (link === '') break;
      const next = api.nextPath(link);
      if (!next.ok) return { prs: distinct(rows), claim: 'doubted', refusal: next.refusal, pages };
      path = next.path;
    }
    const prs = distinct(rows);
    if (prs.length < size) {
      const said = `bitbucket window state=${state} is short (${prs.length} of ${size} matches after ${pages} pages); refusing it rather than printing it as whole`;
      return { prs, claim: 'doubted', refusal: { kind: 'failed', said }, pages };
    }
    return { prs, claim: 'whole', refusal: null, pages };
  };

  const sweepState = async (state: string, branches: readonly string[], since: string | undefined): Promise<StateRead> => {
    const prs: BitbucketPullRequest[] = [];
    let pages = 0;
    for (const branch of branches) {
      let path = queryPath(state, branch, since);
      for (let page = 1; path !== ''; page += 1) {
        if (page > BITBUCKET_BRANCH_QUERY_PAGE_CAP) {
          const said = `bitbucket pr-list state=${state} possibly truncated (${prs.length} rows, page cap ${BITBUCKET_BRANCH_QUERY_PAGE_CAP} reached) — a join against this page may read older branches as 'no PR' (#333)`;
          return { prs, claim: 'none', refusal: { kind: 'failed', said }, pages };
        }
        const answer = await fetchPage(path, `pr-list state=${state.toUpperCase()} branch ${branch}, page ${page}`);
        if (!answer.ok) return { prs, claim: 'none', refusal: answer.refusal, pages };
        pages += 1;
        prs.push(...valuesOf(answer.reply.body));
        const link = nextOf(answer.reply.body);
        if (link === '') break;
        const next = api.nextPath(link);
        if (!next.ok) return { prs, claim: 'none', refusal: next.refusal, pages };
        path = next.path;
      }
    }
    return { prs, claim: 'none', refusal: null, pages };
  };

  /** Rows distinct by id, ascending, as the shell's `unique_by(.id)` orders them. */
  const distinct = (rows: readonly BitbucketPullRequest[]): BitbucketPullRequest[] => {
    const byId = new Map<unknown, BitbucketPullRequest>();
    for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
    return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
  };

  const mergeableOf = async (head: string, base: string): Promise<MergeableReading> => {
    const baseRef = base === '' ? '' : `origin/${base}`;
    if (head === '' || baseRef === '') return bitbucketMergeable({ headSha: head, baseRef, gitVersion: PORT_GIT_VERSION });
    const baseSha = await refs.resolve(baseRef);
    if (!baseSha.ok) return bitbucketMergeable({ headSha: head, baseRef, gitVersion: PORT_GIT_VERSION, baseFetched: false });
    const key = `${head}|${baseSha.value}`;
    const cached = merges.get(key);
    if (cached !== undefined) return cached;
    const headSeen = await refs.resolve(`${head}^{commit}`);
    if (!headSeen.ok) return bitbucketMergeable({ headSha: head, baseRef, gitVersion: PORT_GIT_VERSION, baseFetched: true, headInClone: false });
    const conflicts = await refs.conflictPaths(baseRef, head);
    const reading = bitbucketMergeable({
      headSha: head,
      baseRef,
      gitVersion: PORT_GIT_VERSION,
      baseFetched: true,
      headInClone: true,
      mergeTree: conflicts.ok
        ? { code: conflicts.value.length === 0 ? 0 : 1 }
        : { code: null, stderr: 'git could not compute the merge (git older than 2.38 included)' },
    });
    if (conflicts.ok) merges.set(key, reading);
    return reading;
  };

  const project = async (pr: BitbucketPullRequest, rich: boolean): Promise<PrListingRow> => {
    if (!rich) return bitbucketPlainRow(pr) as PrListingRow;
    const row: BitbucketPrRow = bitbucketRichRow(pr);
    const folded = row.state === 'OPEN' ? { ...row, ...(await mergeableOf(String(row.headSha), String(row.base))) } : row;
    const { base: _base, ...output } = folded;
    return output as PrListingRow;
  };

  const listing = async (query: PrListingQuery): Promise<PrListing> => {
    const states = STATES[query.state] ?? [query.state];
    const branches = query.branches ?? [];
    const rich = query.rich === true || query.richOpen === true;
    const claimed = new Set<string>();
    const doubted = new Set<string>();
    const rows: PrListingRow[] = [];
    let answeredStates = 0;
    let pages = 0;
    for (const state of states) {
      const read = branches.length > 0
        ? await sweepState(state, branches, query.since)
        : query.since !== undefined
          ? await windowState(state, query.since)
          : await plainState(state, query);
      pages += read.pages;
      for (const pr of read.prs) rows.push(await project(pr, rich));
      if (read.claim === 'whole') claimed.add(state);
      if (read.claim === 'doubted') doubted.add(state);
      if (read.refusal !== null) {
        const complete: Record<string, PrListingCompleteness> = {};
        for (const each of states) complete[each] = 'possibly-truncated';
        complete[query.state] = 'possibly-truncated';
        return { answer: pages === 0 ? 'failed' : 'partial', rows: pages === 0 ? [] : rows, complete, refusal: read.refusal };
      }
      answeredStates += 1;
    }
    const sweep = sweepComplete({ branches: branches.length, statesAnswered: answeredStates, statesAsked: states.length });
    return { answer: 'answered', rows, complete: listingWords({ claimed, doubted, sweep }, query.state), refusal: null };
  };

  return {
    prListing: async (query) => {
      const answered = await listing(query);
      refusal = answered.refusal;
      return answered;
    },
    lastRefusal: () => refusal,
  };
};
