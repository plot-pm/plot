import { useCallback, useSyncExternalStore } from 'react';

/** How long a plan's card shows the dispatched confirmation, in milliseconds. */
export const DISPATCH_NOTICE_MS = 5_000;

/** Each plan slug with a notice showing, and the token of the timer that clears it. */
const showing = new Map<string, number>();
const listeners = new Set<() => void>();
let lastToken = 0;

const emit = (): void => {
  for (const listener of listeners) listener();
};

/**
 * Starts the dispatched confirmation on one plan's card. It clears itself after
 * `DISPATCH_NOTICE_MS`; a second call for the same plan restarts the wait, and a
 * call for another plan leaves this one as it is.
 *
 * @param slug - the plan's slug.
 */
export const noteDispatched = (slug: string): void => {
  lastToken += 1;
  const token = lastToken;
  showing.set(slug, token);
  emit();
  setTimeout(() => {
    // A later call for the same plan owns the notice now, and its own timer clears it.
    if (showing.get(slug) !== token) return;
    showing.delete(slug);
    emit();
  }, DISPATCH_NOTICE_MS);
};

/**
 * Whether one plan's card shows the dispatched confirmation now.
 *
 * @param slug - the plan's slug.
 * @returns `true` from `noteDispatched(slug)` until its wait ends.
 */
export const dispatchNoticeShows = (slug: string): boolean => showing.has(slug);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/**
 * Whether one plan's card shows the dispatched confirmation, re-rendering when
 * it starts or clears. The notice lives outside any component, so it survives
 * the Start work control's unmount and the card's own remount.
 *
 * @param slug - the plan's slug.
 * @returns `true` while the notice shows.
 */
export const useDispatchNotice = (slug: string): boolean => {
  const read = useCallback(() => dispatchNoticeShows(slug), [slug]);
  return useSyncExternalStore(subscribe, read, read);
};
