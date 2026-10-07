import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '../../lib/useReducedMotion.js';
import { ArrowLeftIcon, CheckIcon, InfoIcon, MailIcon, Spinner, XIcon } from '../icons.jsx';
import './otp.css';

// Keep in sync with --otp-gather / --otp-spin in otp.css.
const GATHER_MS = 560;
const SPIN_MS = 1100;
const SUCCESS_HOLD_MS = 1650;
const ERROR_RESET_MS = 1000;
const REDUCED_MIN_VERIFY_MS = 450;

const formatClock = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Points on a circle (vertex at the top), assigned to boxes left→right by x
 * so no box crosses another while moving from the row into the orbit.
 */
function orbitPoints(length) {
  return Array.from({ length }, (_, k) => {
    const angle = ((-90 + (360 / length) * k) * Math.PI) / 180;
    return { cos: Math.cos(angle), sin: Math.sin(angle) };
  }).sort((a, b) => a.cos - b.cos);
}

function useTimers() {
  const timers = useRef(new Set());
  useEffect(() => {
    const active = timers.current;
    return () => {
      active.forEach(clearTimeout);
      active.clear();
    };
  }, []);
  return useCallback((fn, ms) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
}

/**
 * Reusable email OTP entry + verification (signup, login, password reset).
 *
 * Verification is always delegated to the server through `onVerify(code)`,
 * which must resolve on success or reject with an ApiError. `onResend()` must
 * resolve to `{ expiresIn, resendIn }` in seconds.
 *
 * States: entry → verifying → success | invalid | expired | locked | ended | error.
 * Motion (visual only): row → orbit → collapse (success) | shake (failure).
 */
export function OTPVerification({
  length = 5,
  destination,
  onVerify,
  onResend,
  expiresIn = 120,
  resendIn = 30,
  onSuccess,
  onBack,
  backLabel = 'Change email',
  title = 'Verify your email',
  description,
  successLabel = 'Email Verified',
  headingLevel = 2,
}) {
  const reducedMotion = useReducedMotion();
  const empty = useMemo(() => Array(length).fill(''), [length]);
  const points = useMemo(() => orbitPoints(length), [length]);

  const [digits, setDigits] = useState(empty);
  const [status, setStatus] = useState('entry');
  const [motion, setMotion] = useState('row');
  const [feedback, setFeedback] = useState(null);
  const [resending, setResending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [timing, setTiming] = useState(() => {
    const now = Date.now();
    return { expiresAt: now + expiresIn * 1000, totalMs: expiresIn * 1000, resendAt: now + resendIn * 1000 };
  });
  const [now, setNow] = useState(() => Date.now());

  const uid = useId();
  const titleId = `${uid}-title`;
  const legendId = `${uid}-legend`;
  const feedbackId = `${uid}-feedback`;
  const timerId = `${uid}-timer`;

  const inputsRef = useRef([]);
  const groupRef = useRef(null);
  const digitsRef = useRef(digits);
  const busyRef = useRef(false);
  const runRef = useRef(0);
  const pendingRef = useRef(null);
  const submittedRef = useRef('');
  const aliveRef = useRef(true);
  const later = useTimers();

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const secondsLeft = Math.max(0, Math.ceil((timing.expiresAt - now) / 1000));
  const resendLeft = Math.max(0, Math.ceil((timing.resendAt - now) / 1000));
  const editable = status === 'entry' || status === 'invalid' || status === 'error';
  const locked = status === 'expired' || status === 'locked' || status === 'ended';

  const announce = useCallback((text) => {
    // Alternate a zero-width suffix so repeated messages are announced again.
    setAnnouncement((prev) => (prev === text ? `${text}​` : text));
  }, []);

  const commit = useCallback((next) => {
    digitsRef.current = next;
    setDigits(next);
  }, []);

  const focusInput = useCallback(
    (index) => {
      const input = inputsRef.current[Math.max(0, Math.min(length - 1, index))];
      if (input && !input.disabled) {
        input.focus();
        input.select();
      }
    },
    [length],
  );

  const expire = useCallback(() => {
    busyRef.current = false;
    setStatus('expired');
    setMotion('row');
    setFeedback({ tone: 'error', title: 'This code has expired.', text: 'Request a new code.' });
    announce('This code has expired. Request a new code.');
  }, [announce]);

  // Countdown clock.
  useEffect(() => {
    if (status === 'success') return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (secondsLeft === 0 && (status === 'entry' || status === 'invalid' || status === 'error')) expire();
  }, [secondsLeft, status, expire]);

  useEffect(() => {
    focusInput(0);
  }, [focusInput]);

  function settle(run, { ok, data, error }) {
    if (run !== runRef.current || !aliveRef.current) return;
    pendingRef.current = null;

    if (ok) {
      setStatus('success');
      setMotion('collapse');
      setFeedback({ tone: 'success', title: successLabel });
      announce(successLabel);
      later(() => onSuccess?.(data), reducedMotion ? 900 : SUCCESS_HOLD_MS);
      return;
    }

    busyRef.current = false;
    switch (error?.code) {
      case 'OTP_INVALID': {
        const left = error.details?.attemptsLeft;
        const hint = left && left <= 2 ? ` ${left} attempt${left === 1 ? '' : 's'} left.` : '';
        setStatus('invalid');
        setMotion('shake');
        setFeedback({ tone: 'error', title: 'Incorrect verification code.', text: `Please try again.${hint}` });
        announce(`Incorrect verification code. Please try again.${hint}`);
        const submitted = submittedRef.current;
        later(() => {
          if (digitsRef.current.join('') !== submitted) return; // the user already started typing
          commit(empty);
          focusInput(0);
        }, reducedMotion ? 300 : ERROR_RESET_MS);
        return;
      }
      case 'OTP_EXPIRED':
        expire();
        return;
      case 'OTP_TOO_MANY_ATTEMPTS':
        setStatus('locked');
        setMotion('shake');
        commit(empty);
        setFeedback({ tone: 'error', title: 'Too many incorrect attempts.', text: 'Request a new code to continue.' });
        announce('Too many incorrect attempts. Request a new code to continue.');
        return;
      case 'VERIFICATION_NOT_FOUND':
        setStatus('ended');
        setMotion('row');
        setFeedback({ tone: 'error', title: 'This verification session has ended.', text: 'Please start again.' });
        announce('This verification session has ended. Please start again.');
        return;
      default: {
        const network = error?.code === 'NETWORK_ERROR';
        const heading = network ? 'Connection problem.' : error?.status === 429 ? 'Please slow down.' : 'Something went wrong.';
        setStatus('error');
        setMotion('row');
        setFeedback({ tone: 'error', title: heading, text: error?.message ?? 'Please try again.', retry: true });
        announce(`${heading} ${error?.message ?? ''}`);
      }
    }
  }

  async function submit(code) {
    if (busyRef.current) return;
    if (Date.now() >= timing.expiresAt) {
      expire();
      return;
    }
    busyRef.current = true;
    const run = ++runRef.current;
    const startedAt = Date.now();
    submittedRef.current = code;
    pendingRef.current = null;
    setStatus('verifying');
    setMotion('orbit');
    setFeedback(null);
    announce('Verifying code…');
    if (groupRef.current?.contains(document.activeElement)) document.activeElement.blur(); // reveal the animation on mobile

    let result;
    try {
      result = { ok: true, data: await onVerify(code) };
    } catch (error) {
      result = { ok: false, error };
    }
    if (run !== runRef.current || !aliveRef.current) return;

    if (reducedMotion) {
      later(() => settle(run, result), Math.max(0, REDUCED_MIN_VERIFY_MS - (Date.now() - startedAt)));
      return;
    }
    // Settle on the next orbit boundary (see handleOrbitIteration) so the rotation
    // never snaps. The fallback only fires if animation events are unavailable.
    pendingRef.current = { run, result };
    later(() => {
      if (pendingRef.current?.run === run) settle(run, result);
    }, GATHER_MS + SPIN_MS + 400);
  }

  function handleOrbitIteration(event) {
    if (event.target !== event.currentTarget || !pendingRef.current) return;
    const { run, result } = pendingRef.current;
    settle(run, result);
  }

  function clearFeedback() {
    if (status === 'invalid' || status === 'error') {
      setStatus('entry');
      setMotion('row');
    }
    if (feedback && feedback.tone !== 'success') setFeedback(null);
  }

  function fillFrom(start, chars) {
    const next = [...digitsRef.current];
    let index = start;
    for (const char of chars) {
      if (index >= length) break;
      next[index] = char;
      index += 1;
    }
    commit(next);
    if (next.every(Boolean)) submit(next.join(''));
    else focusInput(Math.min(index, length - 1));
  }

  function clearDigit(index) {
    const next = [...digitsRef.current];
    next[index] = '';
    commit(next);
  }

  function handleChange(index, event) {
    if (!editable) return;
    const raw = event.target.value;
    let chars = raw.replace(/\D/g, '');
    if (!raw) {
      clearFeedback();
      clearDigit(index);
      return;
    }
    if (!chars) return; // non-numeric input is ignored
    clearFeedback();
    if (chars.length >= length) {
      fillFrom(0, chars.slice(0, length)); // OS autofill / one-time-code suggestion
      return;
    }
    const current = digitsRef.current[index];
    if (current && chars.length > 1 && chars.includes(current)) chars = chars.replace(current, '') || current;
    fillFrom(index, chars);
  }

  function backspace(index) {
    if (!editable) return;
    clearFeedback();
    if (digitsRef.current[index]) {
      clearDigit(index);
    } else if (index > 0) {
      clearDigit(index - 1);
      focusInput(index - 1);
    }
  }

  function handleKeyDown(index, event) {
    switch (event.key) {
      case 'Backspace':
        event.preventDefault();
        backspace(index);
        break;
      case 'Delete':
        event.preventDefault();
        if (editable) {
          clearFeedback();
          clearDigit(index);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusInput(index - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusInput(index + 1);
        break;
      case 'Home':
        event.preventDefault();
        focusInput(0);
        break;
      case 'End':
        event.preventDefault();
        focusInput(length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        if (editable && digitsRef.current.every(Boolean)) submit(digitsRef.current.join(''));
        break;
      default:
        if (event.key.length === 1 && !/\d/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
        }
    }
  }

  function handlePaste(index, event) {
    event.preventDefault();
    if (!editable) return;
    const chars = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, length);
    if (!chars) return;
    clearFeedback();
    fillFrom(chars.length === length ? 0 : index, chars);
  }

  // Android keyboards often report Backspace as "Unidentified"; beforeinput still
  // reports deleteContentBackward, which lets an empty box step back.
  const backspaceRef = useRef(backspace);
  backspaceRef.current = backspace;
  useEffect(() => {
    const group = groupRef.current;
    const onBeforeInput = (event) => {
      if (event.inputType !== 'deleteContentBackward') return;
      const index = inputsRef.current.indexOf(event.target);
      if (index < 0 || digitsRef.current[index]) return;
      event.preventDefault();
      backspaceRef.current(index);
    };
    group.addEventListener('beforeinput', onBeforeInput);
    return () => group.removeEventListener('beforeinput', onBeforeInput);
  }, []);

  async function resend() {
    if (resending || resendLeft > 0 || status === 'verifying' || status === 'success') return;
    setResending(true);
    announce('Sending a new code…');
    try {
      const info = await onResend();
      if (!aliveRef.current) return;
      const time = Date.now();
      setTiming({
        expiresAt: time + info.expiresIn * 1000,
        totalMs: info.expiresIn * 1000,
        resendAt: time + info.resendIn * 1000,
      });
      setNow(time);
      runRef.current += 1;
      busyRef.current = false;
      commit(empty);
      setStatus('entry');
      setMotion('row');
      setFeedback({ tone: 'info', title: 'New code sent.', text: `Check ${destination} for the latest code.` });
      announce(`A new code has been sent to ${destination}.`);
      later(() => focusInput(0), 30);
    } catch (error) {
      if (!aliveRef.current) return;
      if (error.retryAfter) {
        setTiming((prev) => ({ ...prev, resendAt: Date.now() + error.retryAfter * 1000 }));
      }
      if (error.code === 'VERIFICATION_NOT_FOUND') {
        setStatus('ended');
        setFeedback({ tone: 'error', title: 'This verification session has ended.', text: 'Please start again.' });
      } else if (error.code === 'OTP_RESEND_COOLDOWN') {
        setFeedback({ tone: 'info', title: 'Please wait a moment.', text: error.message });
      } else {
        setFeedback({ tone: 'error', title: "Couldn't send a new code.", text: error.message });
      }
      announce(`Couldn't send a new code. ${error.message}`);
    } finally {
      if (aliveRef.current) setResending(false);
    }
  }

  const Heading = `h${headingLevel}`;
  const ratio = Math.max(0, Math.min(1, (timing.expiresAt - now) / timing.totalMs));
  const FeedbackIcon = { success: CheckIcon, error: XIcon, info: InfoIcon }[feedback?.tone];

  return (
    <section className="otp" data-status={status} data-motion={motion} aria-labelledby={titleId}>
      <header className="otp-header">
        <div className="otp-badge" aria-hidden="true">
          <MailIcon width={22} height={22} />
        </div>
        <Heading id={titleId} className="otp-title" tabIndex={-1}>
          {title}
        </Heading>
        <p className="otp-description">
          {description ?? <>We&apos;ve sent a {length}-digit verification code to</>}
          <strong>{destination}</strong>
        </p>
      </header>

      <fieldset
        ref={groupRef}
        className="otp-stage"
        aria-describedby={`${feedbackId} ${timerId}`}
        aria-busy={status === 'verifying'}
      >
        <legend id={legendId} className="sr-only">
          Enter the {length}-digit verification code
        </legend>
        <div className="otp-ring" aria-hidden="true">
          <span className="otp-ring-sweep" />
        </div>
        <div className="otp-shake">
          <div className="otp-orbit" onAnimationIteration={handleOrbitIteration}>
            {digits.map((digit, i) => (
              <div
                key={i}
                className="otp-slot"
                style={{ '--i': i, '--row': i - (length - 1) / 2, '--cos': points[i].cos.toFixed(4), '--sin': points[i].sin.toFixed(4) }}
              >
                <div className="otp-spin">
                  <div className="otp-box" data-filled={digit ? 'true' : undefined}>
                    <input
                      ref={(el) => {
                        inputsRef.current[i] = el;
                      }}
                      className="otp-input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete={i === 0 ? 'one-time-code' : 'off'}
                      enterKeyHint={i === length - 1 ? 'done' : 'next'}
                      maxLength={length}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      value={digit}
                      aria-label={`Digit ${i + 1} of ${length}`}
                      aria-invalid={status === 'invalid' || undefined}
                      readOnly={!editable && !locked}
                      disabled={locked}
                      onChange={(event) => handleChange(i, event)}
                      onKeyDown={(event) => handleKeyDown(i, event)}
                      onPaste={(event) => handlePaste(i, event)}
                      onFocus={(event) => event.target.select()}
                      onClick={(event) => event.target.select()}
                    />
                    <span key={digit || 'empty'} className="otp-digit" aria-hidden="true">
                      {digit}
                    </span>
                    <span className="otp-caret" aria-hidden="true" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="otp-result" aria-hidden="true">
          <svg className="otp-check" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="29" />
            <path d="M20 33.5 28 41.5 44.5 23" />
          </svg>
        </div>
      </fieldset>

      <div className="otp-timer" id={timerId} data-urgent={status === 'entry' && secondsLeft <= 20 ? 'true' : undefined}>
        {status === 'success' ? null : status === 'expired' ? (
          <span>Code expired</span>
        ) : (
          <span>
            Code expires in <time dateTime={`PT${secondsLeft}S`}>{formatClock(secondsLeft)}</time>
          </span>
        )}
        <div className="otp-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${status === 'success' ? 1 : ratio})` }} />
        </div>
      </div>

      <div className="otp-feedback" id={feedbackId} data-tone={feedback?.tone}>
        {feedback && (
          <p key={`${feedback.tone}-${feedback.title}`}>
            <FeedbackIcon width={feedback.tone === 'success' ? 20 : 16} height={feedback.tone === 'success' ? 20 : 16} />
            <span>
              <strong>{feedback.title}</strong>
              {feedback.text && <span className="otp-feedback-text">{feedback.text}</span>}
            </span>
          </p>
        )}
      </div>

      {feedback?.retry && (
        <button type="button" className="btn btn-secondary otp-action" onClick={() => submit(digitsRef.current.join(''))}>
          Try again
        </button>
      )}
      {status === 'ended' && onBack && (
        <button type="button" className="btn btn-secondary otp-action" onClick={onBack}>
          Start again
        </button>
      )}

      {status !== 'success' && status !== 'ended' && (
        <div className="otp-resend">
          <span>Didn&apos;t receive the code?</span>
          {resendLeft > 0 && !resending ? (
            <span className="otp-resend-wait">
              Resend available in <span className="mono">{resendLeft}s</span>
            </span>
          ) : (
            <button
              type="button"
              className="link-button"
              onClick={resend}
              disabled={resending || status === 'verifying'}
              aria-busy={resending || undefined}
            >
              {resending ? (
                <>
                  <Spinner size={14} /> Sending…
                </>
              ) : (
                'Resend Code'
              )}
            </button>
          )}
        </div>
      )}

      {onBack && status !== 'success' && status !== 'verifying' && status !== 'ended' && (
        <button type="button" className="otp-back" onClick={onBack}>
          <ArrowLeftIcon /> {backLabel}
        </button>
      )}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </section>
  );
}
