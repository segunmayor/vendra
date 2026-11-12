import { ActionForm, Card, Field, Input, PageHeader, SubmitButton, Textarea } from '@vendra/ui';
import type { Metadata } from 'next';
import { session } from '../../../../lib/session';
import { saveSettings } from './actions';

export const metadata: Metadata = { title: 'Settings' };

type Setting = Awaited<ReturnType<typeof load>>[number]['settings'][number];
const load = () => session.read((api) => api.GET('/v1/admin/settings'));

function Control({ setting }: { setting: Setting }) {
  const name = `s:${setting.key}`;
  const value = String(setting.value);
  switch (setting.kind) {
    case 'boolean':
      return <input type="checkbox" name={name} defaultChecked={setting.value === true} className="size-5" />;
    case 'integer':
    case 'decimal':
      return (
        <div className="flex items-center gap-2">
          <Input name={name} type="number" defaultValue={value} min={setting.min} max={setting.max} step={setting.kind === 'decimal' ? (setting.step ?? 0.01) : 1} required className="w-32" />
          {setting.unit ? <span className="text-sm text-muted">{setting.unit}</span> : null}
        </div>
      );
    case 'longtext':
      return <Textarea name={name} defaultValue={value} maxLength={setting.maxLength} rows={2} required={!setting.optional} />;
    default:
      return (
        <Input
          name={name}
          type={setting.kind === 'email' ? 'email' : setting.kind === 'url' ? 'url' : setting.kind === 'phone' ? 'tel' : 'text'}
          defaultValue={value}
          maxLength={setting.maxLength}
          required={!setting.optional}
        />
      );
  }
}

export default async function SettingsPage() {
  const groups = await load();
  return (
    <>
      <PageHeader title="Settings" description="Everything here takes effect without a release. Each value has a safe range." />
      <div className="space-y-6">
        {groups.map((group) => (
          <Card key={group.group}>
            <h2 className="text-lg font-semibold">{group.label}</h2>
            <p className="mb-4 text-sm text-muted">{group.description}</p>
            <ActionForm action={saveSettings} className="space-y-4">
              <input type="hidden" name="fields" value={group.settings.map((setting) => `${setting.key}:${setting.kind}`).join(',')} />
              {group.settings.map((setting) => {
                const range = setting.min !== undefined ? `Between ${setting.min} and ${setting.max}.` : '';
                const fallback = setting.isDefault ? '' : `Default: ${String(setting.defaultValue) || 'blank'}.`;
                return (
                  <Field key={setting.key} label={setting.label} hint={[setting.description, range, fallback].filter(Boolean).join(' ')}>
                    <Control setting={setting} />
                  </Field>
                );
              })}
              <SubmitButton>Save {group.label.toLowerCase()}</SubmitButton>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
