import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { passwordProblems, type UserDto } from '@agency-crm/shared';
import { Field } from '@/components/Field';
import { PasswordRules } from '@/components/PasswordRules';
import { apiRequest, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { isValidEmail } from '@/lib/validation';
import { ME_KEY } from './session';

interface Errors {
  displayName?: string | undefined;
  email?: string | undefined;
  password?: string | undefined;
  confirm?: string | undefined;
}

type SignupResponse = { status: 'active'; user: UserDto } | { status: 'pending' };

/**
 * Self-signup. By default the server logs the new user in immediately (session cookie) and the
 * app switches straight to the main screen. Only when the server is configured with
 * SIGNUP_REQUIRES_APPROVAL does it answer "pending" and we show the waiting message.
 * Same password rules as everywhere else (shared policy).
 */
export function SignupPage({ onLogin }: { onLogin: () => void }) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const signup = useMutation({
    mutationFn: async () =>
      (
        await apiRequest<SignupResponse>('POST', '/auth/signup', {
          displayName,
          email: email.trim(),
          password,
        })
      ).data,
    onSuccess: (res) => {
      setPassword('');
      setConfirm('');
      if (res.status === 'active') {
        // Logged in: go to the main screen (clear the #/signup route, then set the session user).
        window.location.hash = '';
        qc.setQueryData(ME_KEY, res.user);
      }
    },
  });

  const validate = (): Errors => ({
    ...(!displayName.trim() ? { displayName: t('signup.nameRequired') } : {}),
    ...(!email.trim()
      ? { email: t('auth.emailRequired') }
      : !isValidEmail(email)
        ? { email: t('auth.emailInvalid') }
        : {}),
    ...(passwordProblems(password, email).length > 0 ? { password: t('password.fixFirst') } : {}),
    ...(confirm !== password || !confirm ? { confirm: t('signup.passwordMismatch') } : {}),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    signup.mutate();
  };

  const clear = (key: keyof Errors) =>
    errors[key] && setErrors((x) => ({ ...x, [key]: undefined }));

  if (signup.data?.status === 'pending') {
    return (
      <main className="flex min-h-full items-center justify-center p-4">
        <section
          role="status"
          aria-labelledby="signup-done-title"
          className="w-full max-w-sm space-y-4 rounded-lg border border-emerald-200 bg-white p-6 shadow-sm"
        >
          <h1 id="signup-done-title" className="text-xl font-bold text-emerald-800">
            {t('signup.doneTitle')}
          </h1>
          <p>{t('signup.doneText')}</p>
          <button
            type="button"
            onClick={onLogin}
            className="w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
          >
            {t('signup.backToLogin')}
          </button>
        </section>
      </main>
    );
  }

  const hasErrors = Object.values(errors).some(Boolean);
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <form
        noValidate
        onSubmit={onSubmit}
        aria-labelledby="signup-title"
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 id="signup-title" className="text-xl font-bold">
          {t('app.name')} · {t('signup.title')}
        </h1>

        <Field
          id="signup-name"
          label={t('signup.displayName')}
          autoComplete="name"
          maxLength={100}
          value={displayName}
          error={errors.displayName ?? null}
          onChange={(e) => {
            setDisplayName(e.target.value);
            clear('displayName');
          }}
        />
        <Field
          id="signup-email"
          label={t('auth.email')}
          type="email"
          dir="ltr"
          autoComplete="email"
          className="text-start"
          value={email}
          error={errors.email ?? null}
          onChange={(e) => {
            setEmail(e.target.value);
            clear('email');
          }}
        />
        <Field
          id="signup-password"
          label={t('auth.password')}
          type="password"
          dir="ltr"
          autoComplete="new-password"
          className="text-start"
          value={password}
          error={errors.password ?? null}
          hintId="signup-password-rules"
          hint={<PasswordRules id="signup-password-rules" password={password} email={email} />}
          onChange={(e) => {
            setPassword(e.target.value);
            clear('password');
          }}
        />
        <Field
          id="signup-confirm"
          label={t('signup.confirmPassword')}
          type="password"
          dir="ltr"
          autoComplete="new-password"
          className="text-start"
          value={confirm}
          error={errors.confirm ?? null}
          onChange={(e) => {
            setConfirm(e.target.value);
            clear('confirm');
          }}
        />

        {(hasErrors || signup.isError) && (
          <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">
            {signup.isError ? errorMessage(signup.error) : t('signup.fixErrors')}
          </p>
        )}

        <button
          type="submit"
          disabled={signup.isPending}
          className="w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {signup.isPending ? t('signup.submitting') : t('signup.submit')}
        </button>

        <p className="text-center text-sm text-slate-600">
          {t('auth.haveAccount')}{' '}
          <button
            type="button"
            onClick={onLogin}
            className="font-medium text-blue-700 underline hover:text-blue-900"
          >
            {t('auth.loginLink')}
          </button>
        </p>
      </form>
    </main>
  );
}
