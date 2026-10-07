import { useEffect, useState } from 'react';
import { parsePhoneNumberFromString } from 'libphonenumber-js/mobile';
import { CheckIcon, LogoutIcon, ShieldIcon } from '../components/icons.jsx';
import { Alert, APP_NAME, Brand, Button } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useRouter } from '../lib/router.jsx';
import { useSession } from '../lib/session.jsx';

const formatDate = (iso) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';

export function Dashboard() {
  const session = useSession();
  const { refresh } = session;
  const { navigate } = useRouter();
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    document.title = `Dashboard · ${APP_NAME}`;
    let active = true;
    // Protected API call: the server enforces the session, not this page.
    api('/account')
      .then((data) => active && setAccount(data.user))
      .catch((err) => {
        if (!active) return;
        if (err.code === 'UNAUTHENTICATED') refresh();
        else if (err.code !== 'SESSION_EXPIRED') setError(err);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await session.signOut();
    } finally {
      navigate('/login', { replace: true });
    }
  };

  const user = account ?? session.user;
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  const phone = parsePhoneNumberFromString(user.phone ?? '')?.formatInternational() ?? user.phone;

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <span className="avatar" aria-hidden="true">
            {initials}
          </span>
          <Button variant="ghost" onClick={logout} loading={loggingOut} loadingText="Logging out…">
            <LogoutIcon /> Log out
          </Button>
        </div>
      </header>

      <main className="dash">
        <section className="dash-hero glass">
          <span className="pill pill-success">
            <span className="pill-dot" /> Session active
          </span>
          <h1>Welcome, {user.firstName}.</h1>
          <p>You&apos;re signed in with a verified email address.</p>
        </section>

        {error && (
          <Alert tone="error" title="Couldn't load your account.">
            {error.message}
          </Alert>
        )}

        <div className="dash-grid">
          <section className="dash-card glass" aria-labelledby="profile-heading">
            <h2 id="profile-heading">Profile</h2>
            <dl className="detail-list">
              <div>
                <dt>Name</dt>
                <dd>
                  {user.firstName} {user.lastName}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd className="detail-email">
                  <span>{user.email}</span>
                  {user.emailVerified && (
                    <span className="pill pill-success pill-sm">
                      <CheckIcon width={12} height={12} /> Verified
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Mobile</dt>
                <dd className="mono">{phone}</dd>
              </div>
              <div>
                <dt>Member since</dt>
                <dd>{formatDate(user.createdAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="dash-card glass" aria-labelledby="security-heading">
            <h2 id="security-heading">Security</h2>
            <ul className="security-list">
              <li>
                <ShieldIcon />
                <div>
                  <strong>Email verification</strong>
                  <span>A 5-digit code protects every sign-in.</span>
                </div>
              </li>
              <li>
                <ShieldIcon />
                <div>
                  <strong>Password</strong>
                  <span>Stored only as a salted scrypt hash.</span>
                </div>
              </li>
              <li>
                <ShieldIcon />
                <div>
                  <strong>This session</strong>
                  <span>Expires {formatDate(session.expiresAt)} unless you stay active.</span>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
