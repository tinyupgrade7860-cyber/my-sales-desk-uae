import { useEffect, useState } from 'preact/hooks';
export interface Route { path: string[]; query: URLSearchParams; raw: string }
function parse(): Route {
  const h = location.hash.replace(/^#/, '') || '/';
  const [p, q] = h.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q || ''), raw: h };
}
export function useRoute() {
  const [r, set] = useState(parse());
  useEffect(() => { const f = () => { set(parse()); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}
export const go = (path: string) => { location.hash = path; };
export const back = (fallback = '/') => { if (history.length > 1) history.back(); else go(fallback); };
export const qp = (name: string) => new URLSearchParams(location.hash.split('?')[1] || '').get(name) || '';
