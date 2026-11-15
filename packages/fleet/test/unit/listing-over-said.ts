import { prListingArgs, prListingOfRun } from '@plot-pm/domain/adapters/host/host-shell';
import { EXIT_BROKE, EXIT_OK, EXIT_PARTIAL, EXIT_QUOTA, EXIT_SECONDARY, EXIT_UNASKABLE } from '@plot-pm/domain/adapters/host-exit';
import type { Host, PrListing, PrListingQuery } from '@plot-pm/domain/ports/host';
import type { HostAnswer } from '@plot-pm/domain/ports/scripts';

/** A `hostSaid`-shaped stub, as the fleet tests write them. */
type SaidStub = (args: readonly string[]) => Promise<HostAnswer>;

/** The `plot-host.sh` run a `hostSaid` answer stands for, so the shell adapter's own reading applies. */
const runOf = (said: HostAnswer) => {
  const loose = said as Partial<{ stdout: string; stderr: string; said: string; kind: string }>;
  if (said.answer === 'answered') return { code: EXIT_OK, stdout: loose.stdout ?? '', stderr: loose.stderr ?? '' };
  if (said.answer === 'partial') return { code: EXIT_PARTIAL, stdout: loose.stdout ?? '', stderr: loose.said ?? '' };
  if (said.answer === 'unaskable') return { code: EXIT_UNASKABLE, stdout: '', stderr: loose.said ?? '' };
  const code = loose.kind === 'throttled' ? EXIT_QUOTA : loose.kind === 'secondary' ? EXIT_SECONDARY : EXIT_BROKE;
  return { code, stdout: '', stderr: loose.said ?? '' };
};

/**
 * Answers `Host.prListing` from a `hostSaid` stub: the stub sees the
 * `pr-list` arguments `host-shell.ts` would pass `plot-host.sh`, and its
 * answer is read by the adapter's own `prListingOfRun`.
 *
 * @param hostSaid - the stub.
 * @returns a `prListing` operation.
 */
export const listingOverSaid = (hostSaid: SaidStub) =>
  async (query: PrListingQuery): Promise<PrListing> => prListingOfRun(query, runOf(await hostSaid(prListingArgs(query))));

/**
 * A host whose `prListing` asks the given `hostSaid` stub.
 *
 * @param host - the host fake to extend.
 * @param hostSaid - the stub.
 * @returns the host with `prListing` over the stub.
 */
export const withSaidListing = (host: Host, hostSaid: SaidStub): Host => ({ ...host, prListing: listingOverSaid(hostSaid) });

/**
 * A scan world whose walk host lists PRs through the world's own `hostSaid`,
 * so a test stubbing `pr-list` there keeps driving the GitHub listing.
 *
 * @param world - the scan world.
 * @returns the world with its walk host's `prListing` over `scripts.hostSaid`.
 */
export const saidListingWorld = <W extends { scripts: { hostSaid: SaidStub }; walk: { host: Host } }>(world: W): W => ({
  ...world,
  walk: { ...world.walk, host: withSaidListing(world.walk.host, (args) => world.scripts.hostSaid(args)) },
});
