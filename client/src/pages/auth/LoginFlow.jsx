import { useState } from 'react';
import { validateLogin } from '@shared/validation.js';
import { OTPVerification } from '../../components/otp/OTPVerification.jsx';
import { PasswordField } from '../../components/form/PasswordField.jsx';
import { TextField } from '../../components/form/TextField.jsx';
import { ArrowRightIcon } from '../../components/icons.jsx';
import { Alert, Button } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { Link, useRouter } from '../../lib/router.jsx';
import { useSession } from '../../lib/session.jsx';
import { useForm } from '../../lib/useForm.js';

const FIELDS = ['email', 'password'];

export function LoginFlow({ onStepChange }) {
  const session = useSession();
  const { navigate } = useRouter();
  const [verification, setVerification] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: validateLogin,
    idPrefix: 'login',
    fieldOrder: FIELDS,
  });

  const complete = (data) => {
    session.signIn(data);
    navigate('/dashboard', { replace: true });
  };

  const submit = form.handleSubmit(async () => {
    setSubmitting(true);
    setFormError(null);
    session.clearNotice();
    try {
      const data = await api('/auth/login', { method: 'POST', body: form.values });
      if (!data.otpRequired) {
        complete(data);
        return;
      }
      setVerification({ ...data.verification, key: Date.now() });
      onStepChange(true);
    } catch (error) {
      if (error.code === 'VALIDATION_ERROR' && error.fields) form.applyServerErrors(error.fields);
      else setFormError(error);
    } finally {
      setSubmitting(false);
    }
  });

  if (verification) {
    return (
      <OTPVerification
        key={verification.key}
        length={verification.length}
        destination={verification.destination}
        expiresIn={verification.expiresIn}
        resendIn={verification.resendIn}
        headingLevel={1}
        title="Verify it’s you"
        successLabel="Verified"
        onVerify={(code) => api('/auth/login/verify-otp', { method: 'POST', body: { code } })}
        onResend={async () => (await api('/auth/login/send-otp', { method: 'POST' })).verification}
        onSuccess={complete}
        onBack={() => {
          setVerification(null);
          onStepChange(false);
        }}
        backLabel="Back to login"
      />
    );
  }

  const errorTitle =
    formError?.code === 'INVALID_CREDENTIALS'
      ? 'Incorrect email or password.'
      : formError?.code === 'RATE_LIMITED'
        ? 'Too many attempts.'
        : formError?.code === 'NETWORK_ERROR'
          ? 'Connection problem.'
          : "We couldn't log you in.";

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      <header className="view-header">
        <h1 tabIndex={-1}>Welcome back</h1>
        <p>Log in with your email and password.</p>
      </header>

      {session.notice && !formError && <Alert tone="info" title={session.notice} />}
      {formError && (
        <Alert tone="error" title={errorTitle}>
          {formError.code === 'INVALID_CREDENTIALS' ? 'Check your details and try again.' : formError.message}
        </Alert>
      )}

      <TextField
        label="Email address"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="you@company.com"
        {...form.fieldProps('email')}
      />
      <PasswordField
        label="Password"
        autoComplete="current-password"
        placeholder="Your password"
        trailingLabel={
          <Link to="/forgot-password" className="field-link">
            Forgot Password?
          </Link>
        }
        {...form.fieldProps('password')}
      />

      <Button type="submit" loading={submitting} loadingText="Logging in…">
        Login <ArrowRightIcon />
      </Button>

      <p className="auth-switch">
        New here? <Link to="/sign-up">Create an account</Link>
      </p>
    </form>
  );
}
