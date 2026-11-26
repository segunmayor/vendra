import type { components } from '@vendra/api-client';
import { Field, Input } from '@vendra/ui';

export type StorageType = components['schemas']['StorageTypeResponse'];
export type StorageLocation = components['schemas']['StorageLocationResponse'];

export const dateTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** The settings and credential fields a storage type needs. Saved credentials are never shown. */
export function LocationFields({ type, location }: { type: StorageType; location?: StorageLocation }) {
  const booleans = type.config.filter((field) => field.kind === 'boolean').map((field) => field.key);
  return (
    <>
      <input type="hidden" name="booleans" value={booleans.join(',')} />
      <Field label="Name" hint="For staff only, such as “Product photos on R2”.">
        <Input name="name" required minLength={2} maxLength={60} defaultValue={location?.name ?? type.label} />
      </Field>
      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold">Settings</legend>
        {type.config.map((field) => {
          const value = location?.config[field.key] ?? field.default ?? '';
          if (field.kind === 'boolean') {
            return (
              <label key={field.key} className="flex items-start gap-3 text-sm">
                <input type="checkbox" name={`config.${field.key}`} defaultChecked={value === 'true'} className="mt-0.5 size-5" />
                <span>
                  <span className="font-medium">{field.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{field.help}</span>
                </span>
              </label>
            );
          }
          return (
            <Field key={field.key} label={`${field.label}${field.required ? '' : ' (optional)'}`} hint={field.help}>
              <Input
                name={`config.${field.key}`}
                type={field.kind === 'url' ? 'url' : 'text'}
                required={field.required}
                defaultValue={value}
                placeholder={field.placeholder}
                maxLength={500}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          );
        })}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold">Credentials</legend>
        <p className="-mt-1 text-xs text-muted">Encrypted when saved, and never shown again.</p>
        {type.credentials.map((field) => {
          const saved = location?.secretHints[field.key];
          return (
            <Field key={field.key} label={field.label} hint={`${field.help} ${saved ? `Saved (${saved}). Leave blank to keep it.` : ''}`.trim()}>
              <Input
                name={`credential.${field.key}`}
                type={field.kind === 'email' ? 'email' : 'password'}
                required={field.required && !saved}
                placeholder={saved ? `Saved ${saved}` : ''}
                maxLength={1000}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          );
        })}
      </fieldset>
    </>
  );
}
