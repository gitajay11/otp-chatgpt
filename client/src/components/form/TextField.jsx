import { AlertIcon } from '../icons.jsx';

export function FieldError({ id, error }) {
  return (
    <div className="field-error" id={id} aria-live="polite">
      {error && (
        <p key={error}>
          <AlertIcon width={14} height={14} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Label + control wrapper + inline error, wired up with aria attributes.
 * `trailingLabel` (e.g. "Forgot password?") renders after the control in the DOM,
 * so tab order goes label → input → link, while CSS places it beside the label.
 */
export function Field({ id, label, error, hint, trailingLabel, children }) {
  return (
    <div className="field" data-invalid={error ? 'true' : undefined}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {trailingLabel && <div className="field-trailing">{trailingLabel}</div>}
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} error={error} />
    </div>
  );
}

export function TextField({ id, label, error, hint, trailingLabel, icon, className, ...inputProps }) {
  return (
    <Field id={id} label={label} error={error} hint={hint} trailingLabel={trailingLabel}>
      <div className="input-wrap" data-invalid={error ? 'true' : undefined}>
        {icon && <span className="input-icon">{icon}</span>}
        <input
          id={id}
          className="input"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          {...inputProps}
        />
      </div>
    </Field>
  );
}
