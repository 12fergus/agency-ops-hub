import type { InputHTMLAttributes, ReactNode } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  /** Hebrew error shown under the field; also marks the input aria-invalid. */
  error?: string | null;
  /** Extra content under the input (e.g. the password checklist). */
  hint?: ReactNode;
  hintId?: string;
}

/** Labelled input with an inline error, wired for screen readers (aria-invalid/describedby). */
export function Field({ id, label, error, hint, hintId, className, ...input }: Props) {
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-md border px-3 py-2 ${
          error ? 'border-red-600 bg-red-50' : 'border-slate-300'
        } ${className ?? ''}`}
        {...input}
      />
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
      {hint}
    </div>
  );
}
