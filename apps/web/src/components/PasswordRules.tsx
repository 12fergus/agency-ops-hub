import { PASSWORD_RULES, passwordProblems, type PasswordRule } from '@agency-crm/shared';
import { t, type MessageKey } from '@/lib/i18n';

/** Rules always shown; the max-length and whitespace rules appear only when broken. */
const ALWAYS_SHOWN: PasswordRule[] = [
  'PASSWORD_TOO_SHORT',
  'PASSWORD_NEEDS_LETTER',
  'PASSWORD_NEEDS_DIGIT',
  'PASSWORD_NEEDS_SYMBOL',
  'PASSWORD_CONTAINS_EMAIL',
];

/**
 * Live checklist under a password field. Uses the SAME policy function as the server, so what the
 * form accepts is exactly what the API accepts.
 */
export function PasswordRules({
  id,
  password,
  email,
}: {
  id: string;
  password: string;
  email: string;
}) {
  const problems = new Set(passwordProblems(password, email));
  const shown = PASSWORD_RULES.filter((r) => ALWAYS_SHOWN.includes(r) || problems.has(r));

  return (
    <div id={id} className="mt-2 text-sm">
      <p className="mb-1 text-slate-600">{t('password.rulesTitle')}</p>
      <ul className="space-y-0.5" aria-live="polite">
        {shown.map((rule) => {
          const ok = !problems.has(rule);
          return (
            <li
              key={rule}
              data-rule={rule}
              data-ok={ok}
              className={`flex items-center gap-2 ${ok ? 'text-emerald-700' : 'text-slate-500'}`}
            >
              <span aria-hidden="true">{ok ? '✓' : '○'}</span>
              <span>{t(`password.rule.${rule}` as MessageKey)}</span>
              <span className="sr-only">— {ok ? t('password.met') : t('password.notMet')}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
