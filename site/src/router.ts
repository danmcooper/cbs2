import { useEffect, useState } from 'react';

export type Route = { screen: 'archive' } | { screen: 'play'; slug: string };

export function parseHash(hash: string): Route {
  const m = hash.match(/^#\/play\/(\d{4}-\d{2}-\d{2}(?:-dan)?)$/);
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
