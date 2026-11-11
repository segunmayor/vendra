import { Input, Select } from '@vendra/ui';
import { ATTRIBUTE_TYPES, type AttributeDefinition } from '../../../../lib/catalogue';

const BLANK_ROWS = 3;

/** The attribute editor. Plain inputs, so it works before JavaScript loads; blank rows are ignored. */
export function AttributeRows({ definitions = [] }: { definitions?: readonly AttributeDefinition[] }) {
  const rows: (AttributeDefinition | null)[] = [...definitions, ...Array<null>(BLANK_ROWS).fill(null)];
  return (
    <fieldset>
      <legend className="text-sm font-semibold">Product details this category asks for</legend>
      <p className="mt-1 mb-3 text-xs text-muted">
        The key is permanent and used by search, such as <code>screen_size</code>. For a choice, list the options separated by commas.
      </p>
      <input type="hidden" name="rows" value={rows.length} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th scope="col" className="pb-1 font-medium">Key</th>
              <th scope="col" className="pb-1 font-medium">Label</th>
              <th scope="col" className="pb-1 font-medium">Type</th>
              <th scope="col" className="pb-1 font-medium">Options</th>
              <th scope="col" className="pb-1 font-medium">Required</th>
              <th scope="col" className="pb-1 font-medium">Remove</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const name = (field: string) => `attributes.${index}.${field}`;
              return (
                <tr key={row?.key ?? `blank-${index}`} className="align-top">
                  <td className="pr-2 pb-2">
                    <Input name={name('key')} defaultValue={row?.key} aria-label={`Key ${index + 1}`} pattern="[a-z][a-z0-9_]{0,39}" placeholder="screen_size" />
                  </td>
                  <td className="pr-2 pb-2">
                    <Input name={name('label')} defaultValue={row?.label} aria-label={`Label ${index + 1}`} maxLength={80} placeholder="Screen size" />
                  </td>
                  <td className="pr-2 pb-2">
                    <Select name={name('type')} defaultValue={row?.type ?? 'text'} aria-label={`Type ${index + 1}`}>
                      {ATTRIBUTE_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="pr-2 pb-2">
                    <Input name={name('options')} defaultValue={row?.options?.join(', ')} aria-label={`Options ${index + 1}`} placeholder="S, M, L" />
                  </td>
                  <td className="pb-2 text-center">
                    <input type="checkbox" name={name('required')} defaultChecked={row?.required} aria-label={`Required ${index + 1}`} className="mt-3 size-4" />
                  </td>
                  <td className="pb-2 text-center">
                    {row ? <input type="checkbox" name={name('remove')} aria-label={`Remove ${row.label}`} className="mt-3 size-4" /> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}
