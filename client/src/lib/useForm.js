import { useCallback, useMemo, useState } from 'react';

/**
 * Small form-state hook around the shared validators.
 * Errors appear after a field is blurred or the form is submitted;
 * server-side field errors show until that field is edited.
 */
export function useForm({ initialValues, validate, idPrefix, fieldOrder }) {
  const [values, setValues] = useState(initialValues);
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState({});

  const validation = useMemo(() => validate(values), [validate, values]);

  const errors = {};
  for (const field of fieldOrder) {
    if (serverErrors[field]) errors[field] = serverErrors[field];
    else if ((touched[field] || submitted) && validation.errors[field]) errors[field] = validation.errors[field];
  }

  const setField = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setServerErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const touch = useCallback((name) => setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true })), []);

  const focusFirstError = useCallback(
    (fieldErrors) => {
      const first = fieldOrder.find((field) => fieldErrors[field]);
      if (first) document.getElementById(`${idPrefix}-${first}`)?.focus();
    },
    [fieldOrder, idPrefix],
  );

  const handleSubmit = (onValid) => (event) => {
    event.preventDefault();
    setSubmitted(true);
    const result = validate(values);
    if (!result.valid) {
      focusFirstError(result.errors);
      return;
    }
    onValid(result.values);
  };

  const applyServerErrors = useCallback(
    (fields) => {
      setServerErrors(fields);
      focusFirstError(fields);
    },
    [focusFirstError],
  );

  const fieldProps = (name) => ({
    id: `${idPrefix}-${name}`,
    name,
    value: values[name],
    error: errors[name],
    onChange: (event) => setField(name, event.target.value),
    onBlur: () => touch(name),
  });

  return { values, errors, setField, touch, handleSubmit, applyServerErrors, fieldProps };
}
