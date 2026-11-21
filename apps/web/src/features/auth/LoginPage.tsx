import { useState, type FormEvent } from 'react';
import { Field } from '@/components/Field';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { isValidEmail } from '@/lib/validation';
import { useAuthOptions, useLogin } from './session';

interface Errors {
  email?: string | undefined;
  password?: string | undefined;
}

export function LoginPage({ onSignup }: { onSignup: () => void }) {
  const login = useLogin();
  const options = useAuthOptions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const validate = (): Errors => ({
    ...(!email.trim()
      ? { email: t('auth.emailRequired') }
      : !isValidEmail(email)
        ? { email: t('auth.emailInvalid') }
        : {}),
    ...(!password ? { password: t('auth.passwordRequired') } : {}),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    login.mutate(
      { email: email.trim(), password },
      // Never keep the password in memory after an attempt.
      { onSettled: () => setPassword('') },
    );
  };

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <form
        noValidate
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        aria-labelledby="login-title"
      >
        <h1 id="login-title" className="text-xl font-bold">
          {t('app.name')} · {t('auth.title')}
        </h1>

        <Field
          id="login-email"
          label={t('auth.email')}
          type="email"
          dir="ltr"
          autoComplete="username"
          className="text-start"
          value={email}
          error={errors.email ?? null}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
          }}
        />

        <Field
          id="login-password"
          label={t('auth.password')}
          type="password"
          dir="ltr"
          autoComplete="current-password"
          className="text-start"
          value={password}
          error={errors.password ?? null}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
          }}
        />

        {login.isError && (
          <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">
            {errorMessage(login.error)}
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {login.isPending ? t('auth.submitting') : t('auth.submit')}
        </button>

        {options.data?.signupEnabled && (
          <p className="text-center text-sm text-slate-600">
            {t('auth.noAccount')}{' '}
            <button
              type="button"
              onClick={onSignup}
              className="font-medium text-blue-700 underline hover:text-blue-900"
            >
              {t('auth.signupLink')}
            </button>
          </p>
        )}
      </form>
    </main>
  );
}
