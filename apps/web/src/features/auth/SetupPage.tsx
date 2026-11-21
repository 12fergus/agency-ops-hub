import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { passwordProblems, type UserDto } from '@agency-crm/shared';
import { Field } from '@/components/Field';
import { PasswordRules } from '@/components/PasswordRules';
import { apiRequest, errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { isValidEmail } from '@/lib/validation';
import { ME_KEY, SETUP_KEY } from './session';

interface Errors {
  code?: string | undefined;
  displayName?: string | undefined;
  email?: string | undefined;
  password?: string | undefined;
  confirm?: string | undefined;
}

/**
 * First-run setup (shown only while the server reports that no admin exists). Requires the
 * one-time code from setup-code.txt in the server's data folder, then creates the first admin and
 * logs them straight in. After that the server closes setup for good.
 */
export function SetupPage() {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const setup = useMutation({
    mutationFn: async () =>
      (
        await apiRequest<{ user: UserDto }>('POST', '/setup', {
          code,
          displayName,
          email: email.trim(),
          password,
        })
      ).data,
    onSuccess: (res) => {
      setPassword('');
      setConfirm('');
      qc.setQueryData(SETUP_KEY, { needsSetup: false });
      qc.setQueryData(ME_KEY, res.user);
    },
  });

  const validate = (): Errors => ({
    ...(!code.trim() ? { code: t('setup.codeRequired') } : {}),
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
    setup.mutate();
  };

  const clear = (key: keyof Errors) =>
    errors[key] && setErrors((x) => ({ ...x, [key]: undefined }));
  const hasErrors = Object.values(errors).some(Boolean);

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <form
        noValidate
        onSubmit={onSubmit}
        aria-labelledby="setup-title"
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 id="setup-title" className="text-xl font-bold">
          {t('app.name')} · {t('setup.title')}
        </h1>
        <p className="text-sm text-slate-600">{t('setup.intro')}</p>

        <Field
          id="setup-code"
          label={t('setup.codeLabel')}
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          className="text-start font-mono tracking-widest uppercase"
          value={code}
          error={errors.code ?? null}
          hintId="setup-code-help"
          hint={
            <p id="setup-code-help" className="mt-1 text-xs text-slate-500">
              {t('setup.codeHelp')}
            </p>
          }
          onChange={(e) => {
            setCode(e.target.value);
            clear('code');
          }}
        />
        <Field
          id="setup-name"
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
          id="setup-email"
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
          id="setup-password"
          label={t('auth.password')}
          type="password"
          dir="ltr"
          autoComplete="new-password"
          className="text-start"
          value={password}
          error={errors.password ?? null}
          hintId="setup-password-rules"
          hint={<PasswordRules id="setup-password-rules" password={password} email={email} />}
          onChange={(e) => {
            setPassword(e.target.value);
            clear('password');
          }}
        />
        <Field
          id="setup-confirm"
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

        {(hasErrors || setup.isError) && (
          <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">
            {setup.isError ? errorMessage(setup.error) : t('signup.fixErrors')}
          </p>
        )}

        <button
          type="submit"
          disabled={setup.isPending}
          className="w-full rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {setup.isPending ? t('setup.submitting') : t('setup.submit')}
        </button>
      </form>
    </main>
  );
}
