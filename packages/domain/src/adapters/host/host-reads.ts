import { answered, failed, unaskable } from '../../port-result.js';
import type { Host, HostRefusal } from '../../ports/host.js';
import { HOST_TRANSPORT_ENV, hostTransportOf, shellReasonOf, type HostTransportChoice } from '../../rules/host-transport.js';
import { refsGit } from '../refs/refs-git.js';
import type { ShellContext } from '../scripts.js';
import {
  BITBUCKET_NO_CREDENTIAL,
  bitbucketApi,
  type BitbucketApi,
  type BitbucketApiOptions,
} from './bitbucket-api.js';
import { bitbucketPrListing, type BitbucketPrListing } from './bitbucket-pr-listing.js';
import { githubApi, type GithubApi, type GithubApiOptions } from './github-api.js';
import { githubPrListing, type GithubPrListing } from './github-pr-listing.js';
import { hostShell, prOf } from './host-shell.js';
import { recordHostReads } from './process-host-reads.js';

/** The backends whose reads the in-process client answers. */
export const IN_PROCESS_BACKENDS: readonly string[] = ['github', 'bitbucket'];

/** The `CI` systems whose colours only the shell's GitHub listing overlays on the checks (`plot-host.sh` pr-list). */
export const SHELL_CI: readonly string[] = ['jenkins'];

/**
 * The `CI` systems whose colours only the shell overlays on the Bitbucket rich
 * open read (`_bb_jen_bind`). The plain reads of such a repository stay
 * in-process; only the rich read goes to the shell.
 */
export const SHELL_RICH_CI: readonly string[] = ['jenkins'];

/**
 * The `CI` systems that keep every read of a backend on the shell.
 *
 * @param backend - the git host backend word, or null.
 * @returns {@link SHELL_CI} on GitHub and none elsewhere.
 */
export const shellCiOf = (backend: string | null): readonly string[] => (backend === 'github' ? SHELL_CI : []);

/** The composition of a process's GitHub reads. */
export interface HostReads {
  /** The transport, its reason and its token source. */
  readonly choice: HostTransportChoice;
  /** The in-process client; null on the shell. */
  readonly api: GithubApi | null;
  /** The `Host` the reads go through: the shell's, with `prListing` in-process on the in-process transport. */
  readonly host: Host;
}

/** What {@link hostReadsFor} reads, besides the context. */
export interface HostReadsBasis {
  /** The git host backend word, or null where the probe did not answer. */
  readonly backend: string | null;
  /** The `CI` config key's value. */
  readonly ci: string;
}

/** The seams {@link hostReadsFor} reads; each has a production default. */
export interface HostReadsOptions {
  /** Reads the switch and the client's variables; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
  /** The shell `Host`; defaults to `hostShell(context)`. */
  readonly shell?: Host;
  /** The `origin` remote's URL; defaults to `git remote get-url origin`. */
  readonly origin?: () => Promise<string | null>;
  /** Builds the GitHub client; defaults to {@link githubApi}. */
  readonly client?: (options: GithubApiOptions) => GithubApi;
  /** Builds the Bitbucket client; defaults to {@link bitbucketApi}. */
  readonly bitbucketClient?: (options: BitbucketApiOptions) => BitbucketApi;
}

/** The `pr-list` states the in-process GitHub listing answers; `settled` reads as `all` on GitHub, as the shell's GitHub arm reads it. */
const LISTED_STATES: Readonly<Record<string, 'open' | 'all' | 'merged'>> = { open: 'open', all: 'all', merged: 'merged', settled: 'all' };

/** The `pr-list` states the in-process Bitbucket listing answers; `settled` is merged and declined there and stays on the shell. */
const BITBUCKET_LISTED_STATES: Readonly<Record<string, 'open' | 'all' | 'merged'>> = { open: 'open', all: 'all', merged: 'merged' };

/** How {@link hostWithListing} divides the reads between the listing and the shell. */
export interface ListingSplit {
  /** The `pr-list` states the listing answers; any other state calls the shell. */
  readonly states?: Readonly<Record<string, 'open' | 'all' | 'merged'>>;
  /** Sends every rich read to the shell, which overlays the CI colours on the checks. */
  readonly richOnShell?: boolean;
}

/**
 * The shell `Host` with `prListing` and `prList` answered in-process.
 *
 * `prList` answers in-process for the states of `split.states` (GitHub's
 * `open`, `all`, `merged` and `settled` by default), with `rich` read as the
 * shell's `--rich-open`; a partial listing answers its rows, as the shell's
 * exit 7 does. With `split.richOnShell`, a rich `prList` and a `prListing`
 * asking `rich` or `richOpen` call the shell. Any other state, and every other
 * operation, calls the shell. `lastRefusal` reports the listing's refusal after an
 * in-process call and the shell's after any other call.
 *
 * @param shell - the shell `Host`.
 * @param listing - the in-process listing.
 * @param split - which reads stay on the shell.
 * @returns the composed `Host`.
 */
export const hostWithListing = (shell: Host, listing: GithubPrListing | BitbucketPrListing, split: ListingSplit = {}): Host => {
  const states = split.states ?? LISTED_STATES;
  let listed = false;
  const composed: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(shell)) {
    composed[name] =
      typeof member === 'function'
        ? (...args: unknown[]): unknown => {
            listed = false;
            return (member as (...a: unknown[]) => unknown)(...args);
          }
        : member;
  }
  return {
    ...(composed as unknown as Host),
    prListing: (query) => {
      if (split.richOnShell === true && (query.rich === true || query.richOpen === true)) {
        listed = false;
        return shell.prListing(query);
      }
      listed = true;
      return listing.prListing(query);
    },
    prList: async (state, limit, since, rich) => {
      const asked = states[state];
      if (asked === undefined || (split.richOnShell === true && rich === true)) {
        listed = false;
        return shell.prList(state, limit, since, rich);
      }
      listed = true;
      const read = await listing.prListing({
        state: asked,
        ...(limit === undefined ? {} : { limit }),
        ...(since === undefined ? {} : { since }),
        ...(rich === true ? { richOpen: true } : {}),
      });
      if (read.answer === 'answered' || read.answer === 'partial') return answered(read.rows.map((row) => prOf(row as Parameters<typeof prOf>[0])));
      return read.answer === 'unaskable' ? unaskable(read.refusal?.said) : failed();
    },
    lastRefusal: (): HostRefusal | null => (listed ? listing.lastRefusal() : shell.lastRefusal()),
  };
};

/**
 * Composes a process's git host reads: the in-process client or the shell.
 *
 * It reads the switch {@link HOST_TRANSPORT_ENV}, the backend and the `CI`
 * key first, and resolves a credential only where none of them keeps the
 * shell. On `bitbucket` the credential is `BB_EMAIL` and `BB_TOKEN` from the
 * environment or `.env`, never the keychain; with none, the shell reads and
 * the reason says so. A Bitbucket repository whose `CI` is in
 * {@link SHELL_RICH_CI} reads its rich open pull requests through the shell
 * and everything else in-process. `api` is the GitHub client and is null on
 * Bitbucket.
 * The client reports its rate-limit observations to the shell `Host`'s
 * `observe`. An in-process composition is recorded for the repository, so
 * `hostForReads` answers it to an adapter that builds its own `Host`. It never
 * rejects: an `origin` that cannot be read builds a client with no slug.
 *
 * @param context - where the scripts and the repository are.
 * @param basis - the backend and the `CI` key.
 * @param options - the seams.
 * @returns the choice, the client and the `Host`.
 */
export const hostReadsFor = async (
  context: ShellContext,
  basis: HostReadsBasis,
  options: HostReadsOptions = {},
): Promise<HostReads> => {
  const env = options.env ?? process.env;
  const shell = options.shell ?? hostShell(context);
  const reading = { ...basis, override: env[HOST_TRANSPORT_ENV], inProcessBackends: IN_PROCESS_BACKENDS, shellCi: shellCiOf(basis.backend) };
  const early = shellReasonOf(reading);
  if (early !== null) return { choice: { transport: 'shell', reason: early, tokenSource: null }, api: null, host: shell };
  const originOf =
    options.origin ??
    (async (): Promise<string | null> => {
      const said = await refsGit(context).remoteUrl('origin');
      return said.ok ? said.value.trim() : null;
    });
  if (basis.backend === 'bitbucket') {
    const bitbucket = (options.bitbucketClient ?? bitbucketApi)({ origin: await originOf(), env, observe: (observed) => shell.observe(observed) });
    const source = await bitbucket.credentialSource();
    const picked = hostTransportOf({ ...reading, tokenSource: source, noCredential: BITBUCKET_NO_CREDENTIAL });
    if (picked.transport === 'shell') return { choice: picked, api: null, host: shell };
    const richOnShell = SHELL_RICH_CI.includes(basis.ci.trim().toLowerCase());
    const host = hostWithListing(shell, bitbucketPrListing(bitbucket, refsGit(context)), { states: BITBUCKET_LISTED_STATES, richOnShell });
    recordHostReads(context.repoRoot, host);
    const reason = richOnShell ? `${picked.reason}; CI is jenkins, so the rich open read stays on the shell` : picked.reason;
    return { choice: { ...picked, reason }, api: null, host };
  }
  const api = (options.client ?? githubApi)({ origin: await originOf(), env, observe: (observed) => shell.observe(observed) });
  const choice = hostTransportOf({ ...reading, tokenSource: await api.tokenSource() });
  if (choice.transport === 'shell') return { choice, api: null, host: shell };
  const host = hostWithListing(shell, githubPrListing(api));
  recordHostReads(context.repoRoot, host);
  return { choice, api, host };
};
