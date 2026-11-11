import { Field, Input, Select } from '@vendra/ui';
import { type AttributeDefinition, type AttributeValues, fieldName } from '../../../../lib/catalogue';

/** One input per category attribute, typed to match its definition. */
export function AttributeFields({ definitions, values = {} }: { definitions: readonly AttributeDefinition[]; values?: AttributeValues }) {
  if (definitions.length === 0) return null;
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-semibold">Category details</legend>
      {definitions.map((definition) => {
        const name = fieldName(definition.key);
        const current = values[definition.key];
        const label = `${definition.label}${definition.required ? ' (required to publish)' : ''}`;
        if (definition.type === 'select' || definition.type === 'boolean') {
          const options = definition.type === 'boolean' ? ['yes', 'no'] : (definition.options ?? []);
          const selected = typeof current === 'boolean' ? (current ? 'yes' : 'no') : (current ?? '');
          return (
            <Field key={definition.key} label={label}>
              <Select name={name} defaultValue={String(selected)}>
                <option value="">Not set</option>
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        return (
          <Field key={definition.key} label={label}>
            <Input
              name={name}
              type={definition.type === 'number' ? 'number' : 'text'}
              step={definition.type === 'number' ? 'any' : undefined}
              maxLength={definition.type === 'text' ? 500 : undefined}
              defaultValue={current === null || current === undefined ? '' : String(current)}
            />
          </Field>
        );
      })}
    </fieldset>
  );
}
