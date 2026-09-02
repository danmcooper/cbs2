import { useEffect, useState } from 'react';
import { ONE_OFFS, VARIANTS } from '../../shared/puzzle';

export type Route = { screen: 'archive' } | { screen: 'play'; slug: string };

/**
 * A play slug is a date plus, optionally, one variant suffix. The alternation
 * is built from `VARIANTS` rather than spelled out, so adding a variant there
 * is enough to make its links open — spelling it out here is what left
 * `-dan-long` routing to the archive, which reads on screen as the archive's
 * Dan Long entries doing nothing when clicked.
 *
 * Longest suffix first: `-dan` is a prefix of `-dan-long`, and while the `$`
 * anchor would force a backtrack to the right one anyway, the order says so
 * without relying on that.
 */
const SUFFIXES = Object.values(VARIANTS)
  .map((v) => v.suffix)
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * A one-off is named rather than dated, so it needs its own alternative here —
 * the dated pattern would send `#/play/10x10` to the archive, which on screen
 * is the link doing nothing. Listing them by name is also the whole mechanism:
 * a slug that is not in `ONE_OFFS` and is not a date is not a route, so the
 * only named puzzles that open are the ones deliberately put here.
 */
const NAMED = Object.keys(ONE_OFFS)
  .map((slug) => slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const PLAY = new RegExp(`^#/play/(\\d{4}-\\d{2}-\\d{2}(?:${SUFFIXES})?|${NAMED})$`);

export function parseHash(hash: string): Route {
  const m = hash.match(PLAY);
  return m ? { screen: 'play', slug: m[1] } : { screen: 'archive' };
}

/** Identifies a route, so a re-read that found no change can keep the old one. */
const keyOf = (route: Route) => (route.screen === 'play' ? `play/${route.slug}` : route.screen);

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const sync = () =>
      setRoute((prev) => {
        const next = parseHash(window.location.hash);
        return keyOf(prev) === keyOf(next) ? prev : next;
      });
    // `hashchange` is the event for a hash that changes while the page is
    // watching. A tab on a phone is often not watching: it comes back from the
    // back/forward cache, or the browser hands an incoming link to a tab it had
    // frozen, and the page can find itself showing one route at an address that
    // says another. Neither of those fires `hashchange`; `pageshow` covers the
    // first and `visibilitychange` the second, so re-read on all three.
    //
    // Re-reading is only safe because it is cheap and idempotent: a parse and,
    // when the route has not moved, the same object back, so a tab that is
    // merely being switched to does not re-render or lose its game state.
    window.addEventListener('hashchange', sync);
    window.addEventListener('pageshow', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('pageshow', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return route;
}
