import { useEffect, useRef } from 'react';
import { t } from '@/lib/i18n';

interface Props {
  /** The question, e.g. "למחוק את איש הקשר?" */
  question: string;
  /** What it applies to — included in the accessible names so rows are distinguishable. */
  target: string;
  /** id of the button that opened this confirmation; focus returns there on cancel. */
  returnFocusTo: string;
  busy?: boolean;
  tone?: 'danger' | 'neutral';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Inline (non-modal) confirmation instead of window.confirm(): no browser dialog, keyboard
 * friendly. Focus starts on "Yes"; Escape or "No" cancels and returns focus to the trigger.
 */
export function ConfirmInline({
  question,
  target,
  returnFocusTo,
  busy,
  tone = 'danger',
  onConfirm,
  onCancel,
}: Props) {
  const yesRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    yesRef.current?.focus();
  }, []);

  const cancel = () => {
    onCancel();
    // The trigger re-mounts after this render; focus it on the next frame.
    requestAnimationFrame(() => document.getElementById(returnFocusTo)?.focus());
  };

  return (
    <div
      role="group"
      aria-label={`${question} ${target}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <span>{question}</span>
      <button
        ref={yesRef}
        type="button"
        disabled={busy}
        aria-label={`${t('common.yes')}: ${target}`}
        onClick={onConfirm}
        className={`rounded px-3 py-1 text-white disabled:opacity-60 ${
          tone === 'danger' ? 'bg-red-700 hover:bg-red-800' : 'bg-blue-700 hover:bg-blue-800'
        }`}
      >
        {t('common.yes')}
      </button>
      <button
        type="button"
        aria-label={`${t('common.no')}: ${target}`}
        onClick={cancel}
        className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
      >
        {t('common.no')}
      </button>
    </div>
  );
}
