import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const RouterContext = createContext(null);

const normalize = (path) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** Minimal History API router: client-side navigation without full page reloads. */
export function RouterProvider({ children }) {
  const [path, setPath] = useState(() => normalize(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPath(normalize(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    const next = normalize(to);
    if (next === normalize(window.location.pathname)) return;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
    setPath(next);
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export const useRouter = () => useContext(RouterContext);

export function Link({ to, replace, onClick, ...props }) {
  const { navigate } = useRouter();
  const handleClick = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(to, { replace });
  };
  return <a href={to} onClick={handleClick} {...props} />;
}

export function Redirect({ to }) {
  const { navigate } = useRouter();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return null;
}
