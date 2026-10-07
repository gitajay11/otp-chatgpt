import { useState } from 'react';
import { validateSignup } from '@shared/validation.js';
import { OTPVerification } from '../../components/otp/OTPVerification.jsx';
import { PasswordField } from '../../components/form/PasswordField.jsx';
import { PhoneField } from '../../components/form/PhoneField.jsx';
import { TextField } from '../../components/form/TextField.jsx';
import { ArrowRightIcon } from '../../components/icons.jsx';
import { Alert, Button } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { detectCountry } from '../../lib/countries.js';
import { Link, useRouter } from '../../lib/router.jsx';
import { useSession } from '../../lib/session.jsx';
import { useForm } from '../../lib/useForm.js';

const FIELDS = ['firstName', 'lastName', 'email', 'phoneCountry', 'phone', 'password', 'confirmPassword'];

export function SignUpFlow({ onStepChange }) {
  const session = useSession();
  const { navigate } = useRouter();
  const [verification, setVerification] = useState(null);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState(null);

  const form = useForm({
    initialValues: {
      firstName: '',
      lastName: '',
      email: '',
      phoneCountry: detectCountry(),
      phone: '',
      password: '',
      confirmPassword: '',
    },
    validate: validateSignup,
    idPrefix: 'signup',
    fieldOrder: FIELDS,
  });
  const { values, errors } = form;

  const submit = form.handleSubmit(async () => {
    setSending(true);
    setFormError(null);
    try {
      const data = await api('/auth/signup', { method: 'POST', body: values });
      setVerification({ ...data.verification, key: Date.now() });
      onStepChange(true);
    } catch (error) {
      if (error.fields) form.applyServerErrors(error.fields);
      if (!error.fields || error.code === 'EMAIL_TAKEN') setFormError(error);
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
        successLabel="Email Verified"
        onVerify={(code) => api('/auth/signup/verify-otp', { method: 'POST', body: { code } })}
        onResend={async () => (await api('/auth/signup/send-otp', { method: 'POST' })).verification}
        onSuccess={(data) => {
          session.signIn(data);
          navigate('/dashboard', { replace: true });
        }}
        onBack={() => {
          setVerification(null);
          onStepChange(false);
        }}
        backLabel="Edit details"
      />
    );
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      <header className="view-header">
        <h1 tabIndex={-1}>Create your account</h1>
        <p>Enter your details. We&apos;ll verify your email in the next step.</p>
      </header>

      {formError &&
        (formError.code === 'EMAIL_TAKEN' ? (
          <Alert tone="info" title="You already have an account.">
            <Link to="/login">Log in instead</Link> or use a different email.
          </Alert>
        ) : (
          <Alert tone="error" title="We couldn't create your account.">
            {formError.message}
          </Alert>
        ))}

      <div className="field-row">
        <TextField label="First name" autoComplete="given-name" placeholder="Ada" {...form.fieldProps('firstName')} />
        <TextField label="Last name" autoComplete="family-name" placeholder="Lovelace" {...form.fieldProps('lastName')} />
      </div>
      <TextField
        label="Email address"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="you@company.com"
        {...form.fieldProps('email')}
      />
      <PhoneField
        idPrefix="signup"
        country={values.phoneCountry}
        number={values.phone}
        countryError={errors.phoneCountry}
        numberError={errors.phone}
        onCountryChange={(iso) => form.setField('phoneCountry', iso)}
        onNumberChange={(number) => form.setField('phone', number)}
        onBlur={() => form.touch('phone')}
      />
      <PasswordField label="Password" autoComplete="new-password" placeholder="Create a password" showStrength {...form.fieldProps('password')} />
      <PasswordField label="Confirm password" autoComplete="new-password" placeholder="Repeat your password" {...form.fieldProps('confirmPassword')} />

      <Button type="submit" loading={sending} loadingText="Sending code…">
        Create account <ArrowRightIcon />
      </Button>

      <p className="auth-switch">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </form>
  );
}
