import { useEffect } from 'react';
import { Spinner } from './components/icons.jsx';
import { APP_NAME, Brand, Button } from './components/ui.jsx';
import { AuthPage, isAuthPath } from './pages/auth/AuthPage.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Link, Redirect, RouterProvider, useRouter } from './lib/router.jsx';
import { SessionProvider, useSession } from './lib/session.jsx';

function CenteredScreen({ children }) {
  return <div className="center-screen">{children}</div>;
}

function NotFound() {
  useEffect(() => {
    document.title = `Not found · ${APP_NAME}`;
  }, []);
  return (
    <CenteredScreen>
      <div className="glass status-card">
        <Brand />
        <h1>Page not found</h1>
        <p>The page you’re looking for doesn’t exist.</p>
        <Link to="/" className="btn btn-secondary">
          Go home
        </Link>
      </div>
    </CenteredScreen>
  );
}

function Routes() {
  const { path } = useRouter();
  const session = useSession();

  if (session.status === 'loading') {
    return (
      <CenteredScreen>
        <div className="loading-state" role="status">
          <Spinner size={22} />
          <span className="sr-only">Loading</span>
        </div>
      </CenteredScreen>
    );
  }

  if (session.status === 'error') {
    return (
      <CenteredScreen>
        <div className="glass status-card" role="alert">
          <Brand />
          <h1>Can’t reach the server</h1>
          <p>{session.error?.message}</p>
          <Button variant="secondary" onClick={session.refresh}>
            Try again
          </Button>
        </div>
      </CenteredScreen>
    );
  }

  const authenticated = session.status === 'authenticated';
  if (path === '/') return <Redirect to={authenticated ? '/dashboard' : '/login'} />;
  if (isAuthPath(path)) return authenticated ? <Redirect to="/dashboard" /> : <AuthPage path={path} />;
  if (path === '/dashboard') return authenticated ? <Dashboard /> : <Redirect to="/login" />;
  return <NotFound />;
}

export function App() {
  return (
    <RouterProvider>
      <SessionProvider>
        <div className="backdrop" aria-hidden="true">
          <div className="backdrop-grid" />
          <div className="backdrop-glow backdrop-glow-1" />
          <div className="backdrop-glow backdrop-glow-2" />
        </div>
        <Routes />
      </SessionProvider>
    </RouterProvider>
  );
}
