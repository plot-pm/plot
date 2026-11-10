/** The environment variable that forces the shell reads for one process. */
export const HOST_TRANSPORT_ENV = 'PLOT_HOST_TRANSPORT';

/** How a process reads the git host: `plot-host.sh`, or the in-process HTTPS client. */
export type HostTransport = 'in-process' | 'shell';

/** What decides the transport, before a token is resolved. */
export interface HostTransportBasis {
  /** The git host backend word, or null where the backend probe did not answer. */
  readonly backend: string | null;
  /** The `CI` config key's value. */
  readonly ci: string;
  /** The value of {@link HOST_TRANSPORT_ENV}, or undefined where it is unset. */
  readonly override: string | undefined;
  /** The backends whose reads the in-process client answers. */
  readonly inProcessBackends: readonly string[];
  /** The `CI` systems whose colours only the shell's listing overlays on the checks. */
  readonly shellCi: readonly string[];
}

/** What decides the transport, a resolved token source included. */
export interface HostTransportReading extends HostTransportBasis {
  /** Where the client's token came from (`GH_TOKEN`, `GITHUB_TOKEN` or `gh auth token`), or null where none resolved. */
  readonly tokenSource: string | null;
}

/** The transport a process reads with, and why. */
export interface HostTransportChoice {
  readonly transport: HostTransport;
  /** One clause naming why. */
  readonly reason: string;
  /** Where the in-process client's token came from; null on the shell. */
  readonly tokenSource: string | null;
}

/**
 * Why a process reads through the shell, decided before any token is asked.
 *
 * {@link HOST_TRANSPORT_ENV} set to `shell` decides first, then a backend
 * outside `inProcessBackends`, then a `CI` system in `shellCi`. Any other
 * value of the switch is ignored.
 *
 * @param basis - the backend, the `CI` key, the switch and the two lists.
 * @returns the reason, or null where the in-process reads may run once a token resolves.
 */
export const shellReasonOf = (basis: HostTransportBasis): string | null => {
  if ((basis.override ?? '').trim().toLowerCase() === 'shell') return `${HOST_TRANSPORT_ENV}=shell`;
  if (basis.backend === null) return 'the git host did not answer';
  if (!basis.inProcessBackends.includes(basis.backend)) return `the git host is ${basis.backend}`;
  const ci = basis.ci.trim().toLowerCase();
  if (basis.shellCi.includes(ci)) return `CI is ${ci}: only the shell overlays its colours on the checks`;
  return null;
};

/**
 * Chooses the transport of a process's GitHub reads.
 *
 * The in-process reads run where {@link shellReasonOf} names no reason and a
 * token resolved; the shell reads otherwise.
 *
 * @param reading - the basis and the token source.
 * @returns the transport, its reason and its token source.
 */
export const hostTransportOf = (reading: HostTransportReading): HostTransportChoice => {
  const shell = shellReasonOf(reading);
  if (shell !== null) return { transport: 'shell', reason: shell, tokenSource: null };
  if (reading.tokenSource === null) {
    return { transport: 'shell', reason: 'no token: GH_TOKEN, GITHUB_TOKEN and gh auth token answered none', tokenSource: null };
  }
  return { transport: 'in-process', reason: `the git host is ${String(reading.backend)}`, tokenSource: reading.tokenSource };
};

/**
 * The one line a process logs at start about its transport. It names the
 * token source and never the token.
 *
 * @param choice - the transport choice.
 * @returns the line, with no trailing newline.
 */
export const hostTransportLine = (choice: HostTransportChoice): string =>
  `host reads: ${choice.transport} (${choice.reason}${choice.tokenSource === null ? '' : `; token from ${choice.tokenSource}`})`;

/**
 * The `/plot-fleet --status` line for the transport fleetd published.
 *
 * @param choice - the transport fleetd's heartbeat carries, or undefined where it carries none.
 * @returns the indented line, newline-terminated.
 */
export const hostTransportStatusLine = (choice: HostTransportChoice | undefined): string =>
  `  ${choice === undefined ? 'host reads: not reported (fleetd published no transport)' : hostTransportLine(choice)}\n`;
