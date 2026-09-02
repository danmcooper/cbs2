import { useEffect, useState } from 'react';
import { VARIANTS } from '../../shared/puzzle';

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

const PLAY = new RegExp(`^#/play/(\\d{4}-\\d{2}-\\d{2}(?:${SUFFIXES})?)$`);

export function parseHash(hash: string): Route {
  const m = hash.match(PLAY);
  return m ? { screen: 'play', slug: m[1] } : { screen: 'archive' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
