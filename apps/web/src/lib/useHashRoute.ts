import { useEffect, useState } from 'react';

/**
 * Tiny hash router (`#/users`) — two pages don't justify a router dependency.
 * Survives refresh; no server routes needed.
 */
export function useHashRoute(): [string, (route: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '');
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [route, (r: string) => (window.location.hash = r ? `/${r}` : '')];
}
