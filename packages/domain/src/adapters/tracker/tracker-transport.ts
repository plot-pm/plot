import type { HostTransportChoice } from '../../rules/host-transport.js';
import { HOST_TRANSPORT_ENV } from '../../rules/host-transport.js';
import { trackerTransportOf } from '../../rules/tracker-transport.js';
import type { ShellContext } from '../scripts.js';
import { jiraApi, type JiraApi, type JiraApiOptions, type JiraCredentialSource } from './jira-api.js';
import type { JiraInProcess } from './tracker-jira.js';

/** The composition of a process's tracker reads. */
export interface TrackerReads {
  /** The transport, its reason and its credential source; null where the declared tracker is not Jira. */
  readonly choice: HostTransportChoice | null;
  /** The in-process Jira reads; null on the shell and for any other tracker. */
  readonly jira: JiraInProcess | null;
}

/** The seams {@link trackerReadsFor} reads; each has a production default. */
export interface TrackerReadsOptions {
  /** Reads the switch and the client's variables; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
  /** Builds the client; defaults to {@link jiraApi}. */
  readonly client?: (options: JiraApiOptions) => JiraApi;
}

const sourceText = (source: JiraCredentialSource | null): string | null =>
  source === null ? null : source.kind === 'environment' ? 'the environment' : source.path;

/**
 * Composes a process's tracker reads: the in-process Jira client or the shell.
 *
 * It reads {@link HOST_TRANSPORT_ENV} first and resolves credentials only where
 * the switch and the base URL keep the in-process path open. One switch covers
 * the git host and the tracker. It never rejects.
 *
 * @param context - where the scripts and the repository are.
 * @param declared - the `Tracker` config key's value, verbatim.
 * @param ticketPrefixes - the `Ticket prefixes` config value, as written.
 * @param options - the seams.
 * @returns the choice and the in-process reads.
 */
export const trackerReadsFor = (
  context: ShellContext,
  declared: string,
  ticketPrefixes: string,
  options: TrackerReadsOptions = {},
): TrackerReads => {
  const env = options.env ?? process.env;
  const [scheme = '', configured = ''] = declared.trim().split(/\s+/);
  const override = env[HOST_TRANSPORT_ENV];
  const api = (options.client ?? jiraApi)({ repoRoot: context.repoRoot, baseUrl: configured, env });
  // CREDENTIALS ARE READ ONLY WHERE THE SWITCH AND THE BASE URL LEAVE THE PATH
  // OPEN: a forced shell never touches `.env`.
  const forced = (override ?? '').trim().toLowerCase() === 'shell';
  const credentialSource = forced || api.base === '' ? null : sourceText(api.credentialSource());
  const choice = trackerTransportOf({ hasClient: scheme.toLowerCase() === 'jira', override, baseUrl: api.base, credentialSource });
  if (choice === null || choice.transport === 'shell') return { choice, jira: null };
  return { choice, jira: { api, ticketPrefixes, env } };
};
