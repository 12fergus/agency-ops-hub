import { useRef, useState, type ChangeEvent } from 'react';
import { PHOTO_TYPES } from '@agency-crm/shared';
import { ConfirmInline } from '@/components/ConfirmInline';
import { errorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { usePhotoMutations } from './api';
import { ClientAvatar } from './ClientAvatar';
import { prepareImage } from './prepareImage';

/**
 * Client photo/logo with upload / replace / remove for users who may edit the client.
 * The browser checks type and size for instant feedback; the server re-checks by CONTENT.
 */
export function PhotoBlock({
  clientId,
  name,
  photoUrl,
  canEdit,
}: {
  clientId: string;
  name: string;
  photoUrl: string | null;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { upload, remove } = usePhotoMutations(clientId);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    setLocalError(null);
    setPreparing(true);
    // Big phone photos are shrunk in the browser first, so they fit the 2 MB server limit.
    void prepareImage(file)
      .then((prepared) => {
        if (!prepared.ok) {
          setLocalError(
            t(prepared.reason === 'type' ? 'error.PHOTO_TYPE' : 'error.PHOTO_TOO_LARGE'),
          );
          return;
        }
        upload.mutate(prepared.file);
      })
      .catch(() => setLocalError(t('error.PHOTO_TYPE')))
      .finally(() => setPreparing(false));
  };
  const busy = preparing || upload.isPending;

  const error =
    localError ??
    (upload.isError ? errorMessage(upload.error) : null) ??
    (remove.isError ? errorMessage(remove.error) : null);

  return (
    <div className="flex flex-col items-center gap-1">
      <ClientAvatar name={name} photoUrl={photoUrl} size="lg" />
      {canEdit && (
        <div className="flex flex-col items-center gap-1 text-xs">
          <input
            ref={inputRef}
            id="client-photo-input"
            type="file"
            accept={['image/*', ...PHOTO_TYPES].join(',')}
            onChange={onFile}
            className="sr-only"
            aria-describedby="client-photo-help"
          />
          <button
            type="button"
            id="client-photo-button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
          >
            {busy
              ? t('clients.photoUploading')
              : photoUrl
                ? t('clients.photoReplace')
                : t('clients.photoUpload')}
          </button>
          {photoUrl &&
            (confirmRemove ? (
              <ConfirmInline
                question={t('clients.photoRemoveConfirm')}
                target={name}
                returnFocusTo="client-photo-remove"
                busy={remove.isPending}
                onConfirm={() =>
                  remove.mutate(undefined, { onSettled: () => setConfirmRemove(false) })
                }
                onCancel={() => setConfirmRemove(false)}
              />
            ) : (
              <button
                type="button"
                id="client-photo-remove"
                onClick={() => setConfirmRemove(true)}
                className="text-red-700 underline"
              >
                {t('clients.photoRemove')}
              </button>
            ))}
          <span id="client-photo-help" className="text-slate-500">
            {t('clients.photoHelp')}
          </span>
          {error && (
            <span role="alert" className="text-red-700">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
