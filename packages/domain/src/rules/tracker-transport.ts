import { HOST_TRANSPORT_ENV, type HostTransportChoice } from './host-transport.js';

/** What decides the transport of the tracker's reads, before a client is built. */
export interface TrackerTransportReading {
  /** The `Tracker` key's scheme, or `''` where none is declared. */
  readonly scheme: string;
  /** The value of {@link HOST_TRANSPORT_ENV}, or undefined where it is unset. */
  readonly override: string | undefined;
  /** The client's base URL, or `''` where none is configured. */
  readonly baseUrl: string;
  /** Where the client's credentials came from, such as `the environment` or a `.env` path, or null where none resolved. */
  readonly credentialSource: string | null;
}

/** The one tracker scheme whose reads run in-process. */
export const IN_PROCESS_TRACKER_SCHEME = 'jira';

/**
 * Chooses the transport of the tracker's idle reads.
 *
 * The in-process client reads where the declared tracker is `jira`, the switch
 * {@link HOST_TRANSPORT_ENV} is not `shell`, a base URL is configured and the
 * credentials resolved. Every other case reads through `plot-host.sh`, and the
 * reason names the first condition that failed. The choice is `null` for a
 * tracker that is not `jira`: there is no tracker transport to report.
 *
 * @param reading - the scheme, the switch, the base URL and the credential source.
 * @returns the choice, or null where the declared tracker is not Jira.
 */
export const trackerTransportOf = (reading: TrackerTransportReading): HostTransportChoice | null => {
  if (reading.scheme.toLowerCase() !== IN_PROCESS_TRACKER_SCHEME) return null;
  if ((reading.override ?? '').trim().toLowerCase() === 'shell') {
    return { transport: 'shell', reason: `${HOST_TRANSPORT_ENV}=shell`, tokenSource: null };
  }
  if (reading.baseUrl === '') return { transport: 'shell', reason: 'no Jira base URL is configured', tokenSource: null };
  if (reading.credentialSource === null) {
    return { transport: 'shell', reason: 'no credentials: JIRA_EMAIL and JIRA_API_TOKEN are in neither the environment nor .env', tokenSource: null };
  }
  return { transport: 'in-process', reason: 'the tracker is jira', tokenSource: reading.credentialSource };
};

/**
 * The one line a process logs at start about its tracker transport. It names
 * the credential source and never the credential.
 *
 * @param choice - the tracker transport choice.
 * @returns the line, with no trailing newline.
 */
export const trackerTransportLine = (choice: HostTransportChoice): string =>
  `tracker reads: ${choice.transport} (${choice.reason}${choice.tokenSource === null ? '' : `; credentials from ${choice.tokenSource}`})`;

/**
 * The `/plot-fleet --status` line for the tracker transport fleetd published.
 *
 * @param choice - the transport fleetd's heartbeat carries, or undefined where it carries none.
 * @returns the indented line, newline-terminated; empty where fleetd published none, as for a tracker that is not Jira.
 */
export const trackerTransportStatusLine = (choice: HostTransportChoice | undefined): string =>
  choice === undefined ? '' : `  ${trackerTransportLine(choice)}\n`;
