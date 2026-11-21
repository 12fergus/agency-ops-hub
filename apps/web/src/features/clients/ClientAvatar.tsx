import { useState } from 'react';
import { t } from '@/lib/i18n';

/**
 * Client photo/logo, or initials when there is none (or it fails to load).
 * `photoUrl` is a same-origin, session-protected URL (CSP img-src 'self').
 */
export function ClientAvatar({
  name,
  photoUrl,
  size = 'sm',
}: {
  name: string;
  photoUrl: string | null;
  size?: 'sm' | 'lg';
}) {
  // Remember WHICH url failed, so a new photo (new versioned url) is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = photoUrl !== null && failedUrl === photoUrl;
  const box = size === 'lg' ? 'h-24 w-24 text-2xl' : 'h-8 w-8 text-xs';
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={size === 'lg' ? t('clients.photoAlt') : ''}
        onError={() => setFailedUrl(photoUrl)}
        className={`${box} shrink-0 rounded-full border border-slate-200 bg-white object-cover`}
      />
    );
  }
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('');
  return (
    <span
      aria-hidden="true"
      className={`${box} inline-flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-700`}
    >
      {initials}
    </span>
  );
}
