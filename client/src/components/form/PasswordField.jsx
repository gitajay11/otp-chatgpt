import { useState } from 'react';
import { PASSWORD_RULES, passwordScore } from '@shared/validation.js';
import { CheckIcon, EyeIcon, EyeOffIcon } from '../icons.jsx';
import { Field } from './TextField.jsx';

const STRENGTH = ['Too weak', 'Weak', 'Weak', 'Fair', 'Good', 'Strong'];

export function PasswordField({ id, label, error, value, showStrength = false, trailingLabel, ...inputProps }) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const score = passwordScore(value);
  const showMeter = showStrength && (focused || value.length > 0);
  const describedBy = [error && `${id}-error`, showMeter && `${id}-strength`].filter(Boolean).join(' ') || undefined;

  return (
    <Field id={id} label={label} error={error} trailingLabel={trailingLabel}>
      <div className="input-wrap" data-invalid={error ? 'true' : undefined}>
        <input
          id={id}
          className="input"
          type={visible ? 'text' : 'password'}
          value={value}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          autoCapitalize="off"
          spellCheck={false}
          {...inputProps}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            setFocused(false);
            inputProps.onBlur?.(event);
          }}
        />
        <button
          type="button"
          className="input-action"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>

      {showStrength && (
        <div className="strength" id={`${id}-strength`} data-visible={showMeter ? 'true' : undefined} data-score={score}>
          <div className="strength-inner">
            <div className="strength-head">
              <div className="strength-bar" aria-hidden="true">
                {PASSWORD_RULES.map((rule, i) => (
                  <span key={rule.id} data-on={i < score ? 'true' : undefined} />
                ))}
              </div>
              <span className="strength-label">{value ? STRENGTH[score] : 'Password strength'}</span>
            </div>
            <ul className="strength-rules">
              {PASSWORD_RULES.map((rule) => {
                const met = rule.test(value);
                return (
                  <li key={rule.id} data-met={met ? 'true' : undefined}>
                    <span className="strength-dot" aria-hidden="true">
                      {met && <CheckIcon width={10} height={10} strokeWidth={3} />}
                    </span>
                    {rule.label}
                    <span className="sr-only">{met ? ' (met)' : ' (not met)'}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Field>
  );
}
