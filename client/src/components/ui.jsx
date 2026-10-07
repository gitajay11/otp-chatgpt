import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AlertIcon, CheckIcon, InfoIcon, Spinner } from './icons.jsx';

export function Button({ loading = false, loadingText, variant = 'primary', children, disabled, className = '', ...props }) {
  return (
    <button
      className={`btn btn-${variant} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Spinner />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

const ALERT_ICONS = { error: AlertIcon, info: InfoIcon, success: CheckIcon };

export function Alert({ tone = 'error', title, children }) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div className="alert" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon width={16} height={16} />
      <div>
        {title && <strong>{title}</strong>}
        {children && <span>{children}</span>}
      </div>
    </div>
  );
}

/** Smoothly animates its height whenever the content's height changes. */
export function AnimatedHeight({ children, duration = 380 }) {
  const innerRef = useRef(null);
  const [height, setHeight] = useState(null);
  const [animating, setAnimating] = useState(false);
  const previous = useRef(null);

  useLayoutEffect(() => {
    const element = innerRef.current;
    const observer = new ResizeObserver(() => {
      const next = element.offsetHeight;
      if (previous.current !== null && previous.current !== next) setAnimating(true);
      previous.current = next;
      setHeight(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!animating) return undefined;
    const id = setTimeout(() => setAnimating(false), duration + 40);
    return () => clearTimeout(id);
  }, [animating, height, duration]);

  return (
    <div
      className="animated-height"
      // While resizing, clip only the bottom edge so horizontal slides and focus glows stay visible.
      style={{
        height: height ?? 'auto',
        clipPath: animating ? 'inset(-16px -64px 0 -64px)' : undefined,
        transitionDuration: `${duration}ms`,
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

export function BrandMark({ size = 30 }) {
  // Unique per instance: a gradient inside a display:none subtree can't be referenced.
  const gradientId = `brand-gradient-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4d7cff" />
          <stop offset="1" stopColor="#a35cff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <circle cx="16" cy="16" r="7.5" fill="none" stroke="#fff" strokeOpacity=".9" strokeWidth="2" />
      <circle cx="22.5" cy="10.5" r="2.6" fill="#fff" />
    </svg>
  );
}

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Orbit';

export function Brand() {
  return (
    <span className="brand">
      <BrandMark />
      <span className="brand-name">{APP_NAME}</span>
    </span>
  );
}
