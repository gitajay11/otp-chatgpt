import { useState } from 'react';
import { validatePasswordReset } from '@shared/validation.js';
import { OTPVerification } from '../../components/otp/OTPVerification.jsx';
import { PasswordField } from '../../components/form/PasswordField.jsx';
import { TextField } from '../../components/form/TextField.jsx';
import { ArrowLeftIcon } from '../../components/icons.jsx';
import { Alert, Button } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { Link, useRouter } from '../../lib/router.jsx';
import { useSession } from '../../lib/session.jsx';
import { useForm } from '../../lib/useForm.js';

const FIELDS = ['email', 'password', 'confirmPassword'];

/** Password reset reuses the same OTP component and server-side flow. */
export function ForgotPasswordFlow({ onStepChange }) {
  const session = useSession();
  const { navigate } = useRouter();
  const [verification, setVerification] = useState(null);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState(null);

  const form = useForm({
    initialValues: { email: '', password: '', confirmPassword: '' },
    validate: validatePasswordReset,
    idPrefix: 'reset',
    fieldOrder: FIELDS,
  });

  const submit = form.handleSubmit(async () => {
    setSending(true);
    setFormError(null);
    try {
      const data = await api('/auth/password-reset', { method: 'POST', body: form.values });
      setVerification({ ...data.verification, key: Date.now() });
      onStepChange(true);
    } catch (error) {
      if (error.code === 'VALIDATION_ERROR' && error.fields) form.applyServerErrors(error.fields);
      else setFormError(error);
    } finally {
      setSending(false);
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
        title="Check your email"
        description={<>If an account exists, we&apos;ve sent a {verification.length}-digit code to</>}
        successLabel="Password updated"
        onVerify={(code) => api('/auth/password-reset/verify-otp', { method: 'POST', body: { code } })}
        onResend={async () => (await api('/auth/password-reset/send-otp', { method: 'POST' })).verification}
        onSuccess={(data) => {
          session.signIn(data);
          navigate('/dashboard', { replace: true });
        }}
        onBack={() => {
          setVerification(null);
          onStepChange(false);
        }}
        backLabel="Change email"
      />
    );
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      <header className="view-header">
        <h1 tabIndex={-1}>Reset your password</h1>
        <p>Choose a new password. We&apos;ll email you a code to confirm it&apos;s you.</p>
      </header>

      {formError && (
        <Alert tone="error" title="We couldn't start the reset.">
          {formError.message}
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
      <PasswordField label="New password" autoComplete="new-password" placeholder="Create a new password" showStrength {...form.fieldProps('password')} />
      <PasswordField label="Confirm new password" autoComplete="new-password" placeholder="Repeat the new password" {...form.fieldProps('confirmPassword')} />

      <Button type="submit" loading={sending} loadingText="Sending code…">
        Send verification code
      </Button>

      <p className="auth-switch">
        <Link to="/login" className="back-link">
          <ArrowLeftIcon /> Back to login
        </Link>
      </p>
    </form>
  );
}
