import { useEffect, useRef, useState } from 'react';
import { AnimatedHeight, APP_NAME, Brand } from '../../components/ui.jsx';
import { Link } from '../../lib/router.jsx';
import { ForgotPasswordFlow } from './ForgotPasswordFlow.jsx';
import { LoginFlow } from './LoginFlow.jsx';
import { SignUpFlow } from './SignUpFlow.jsx';

const VIEWS = {
  '/sign-up': { title: 'Sign up', tab: 'signup', Flow: SignUpFlow },
  '/login': { title: 'Log in', tab: 'login', Flow: LoginFlow },
  '/forgot-password': { title: 'Reset password', tab: null, Flow: ForgotPasswordFlow },
};
const ORDER = Object.keys(VIEWS);

export const isAuthPath = (path) => path in VIEWS;

function AuthTabs({ active }) {
  return (
    <nav className="auth-tabs" aria-label="Account" data-active={active}>
      <span className="auth-tabs-indicator" aria-hidden="true" />
      <Link to="/sign-up" aria-current={active === 'signup' ? 'page' : undefined}>
        Sign up
      </Link>
      <Link to="/login" aria-current={active === 'login' ? 'page' : undefined}>
        Log in
      </Link>
    </nav>
  );
}

function HeroOrbit() {
  return (
    <div className="hero-orbit" aria-hidden="true">
      <div className="hero-ring hero-ring-1" />
      <div className="hero-ring hero-ring-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="hero-node" style={{ '--i': i }}>
            <span>{(i * 7 + 3) % 10}</span>
          </span>
        ))}
      </div>
      <div className="hero-core">
        <span />
      </div>
    </div>
  );
}

export function AuthPage({ path }) {
  const view = VIEWS[path];
  const [verifying, setVerifying] = useState(false);
  const cardRef = useRef(null);
  const motion = useRef({ path, direction: 'none' });

  // Slide direction follows the tab order: Sign up ← → Log in → Reset.
  if (motion.current.path !== path) {
    motion.current = {
      path,
      direction: ORDER.indexOf(path) > ORDER.indexOf(motion.current.path) ? 'forward' : 'back',
    };
  }

  useEffect(() => {
    document.title = `${view.title} · ${APP_NAME}`;
  }, [view.title]);

  // On client-side navigation, move focus to the new view's heading.
  const firstRender = useRef(true);
  useEffect(() => {
    setVerifying(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    cardRef.current?.querySelector('h1')?.focus({ preventScroll: true });
  }, [path]);

  const { Flow } = view;
  return (
    <div className="auth-shell">
      <aside className="auth-hero">
        <Brand />
        <div className="hero-copy">
          <p className="hero-eyebrow">Secure access</p>
          <p className="hero-title">
            Every sign-in,
            <br />
            <span className="gradient-text">verified in seconds.</span>
          </p>
          <p className="hero-text">One account, protected by a single-use code sent to your inbox each time it matters.</p>
        </div>
        <HeroOrbit />
        <dl className="hero-specs">
          <div>
            <dt>OTP</dt>
            <dd>5-digit · single use · 2 min</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>HttpOnly · SameSite · rotating</dd>
          </div>
          <div>
            <dt>Password</dt>
            <dd>scrypt · salted · never stored</dd>
          </div>
        </dl>
      </aside>

      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-card glass" ref={cardRef}>
          {view.tab && !verifying && <AuthTabs active={view.tab} />}
          <AnimatedHeight>
            <div key={path} className="auth-view" data-direction={motion.current.direction}>
              <Flow onStepChange={setVerifying} />
            </div>
          </AnimatedHeight>
        </div>
        <p className="auth-footnote">Protected by email verification and encrypted sessions.</p>
      </main>
    </div>
  );
}
