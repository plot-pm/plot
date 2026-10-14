import { parseDiscoveryShow, type DiscoveryShow } from '@plot-pm/domain';

/** The query parameter the Discovery tab's group control keeps. */
export const SHOW_PARAM = 'show';

/**
 * Which Discovery groups a query string asks for.
 *
 * @param search - a `location.search` value.
 * @returns `tickets` or `stories` for `show=tickets` or `show=stories`; `both` for anything else.
 */
export const showOf = (search: string): DiscoveryShow => parseDiscoveryShow(new URLSearchParams(search).get(SHOW_PARAM));

/**
 * The address with the choice written: `show=tickets` or `show=stories` set,
 * or `show` removed for `both`. Every other parameter stays as it was.
 *
 * @param href - the current address.
 * @param show - the new choice.
 * @returns the address to keep in the history.
 */
export const withShow = (href: string, show: DiscoveryShow): URL => {
  const url = new URL(href);
  if (show === 'both') url.searchParams.delete(SHOW_PARAM);
  else url.searchParams.set(SHOW_PARAM, show);
  return url;
};
