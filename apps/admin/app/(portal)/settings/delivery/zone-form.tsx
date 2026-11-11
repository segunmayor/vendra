import { ActionForm, Field, Input, SubmitButton, type FormState } from '@vendra/ui';
import { BAND_ROWS, STATES } from '../../../../lib/delivery';

export interface ZoneValues {
  code: string;
  name: string;
  states: readonly string[];
  rates: readonly { maxWeightGrams: number; priceMinor: string }[];
}

const naira = (kobo: string) => (kobo.endsWith('00') ? kobo.slice(0, -2) || '0' : `${kobo.slice(0, -2) || '0'}.${kobo.slice(-2)}`);

/** States taken by other zones are shown but disabled, since a state belongs to one zone. */
export function ZoneForm({
  action,
  zone,
  taken,
  submit,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  zone?: ZoneValues;
  taken: ReadonlyMap<string, string>;
  submit: string;
}) {
  return (
    <ActionForm action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="Shown to customers, such as Lagos or South West.">
          <Input name="name" defaultValue={zone?.name} required minLength={2} maxLength={80} />
        </Field>
        <Field label="Code" hint="Short and permanent, such as lagos or south_west.">
          <Input name="code" defaultValue={zone?.code} required pattern="[a-z][a-z0-9_]{1,31}" />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">States covered</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {STATES.map((state) => {
            const owner = taken.get(state);
            return (
              <label key={state} className={`flex items-center gap-2 ${owner ? 'text-muted' : ''}`} title={owner ? `In ${owner}` : undefined}>
                <input type="checkbox" name="states" value={state} defaultChecked={zone?.states.includes(state)} disabled={!!owner} className="size-4" />
                {state}
                {owner ? <span className="text-xs">({owner})</span> : null}
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Prices by parcel weight</legend>
        <p className="mb-3 text-xs text-muted">Each band covers parcels up to its weight. Orders heavier than the last band cannot be delivered to this zone.</p>
        <div className="space-y-2">
          {Array.from({ length: BAND_ROWS }, (_, index) => {
            const rate = zone?.rates[index];
            return (
              <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-14 text-muted">Up to</span>
                <Input name={`band.${index}.kg`} inputMode="decimal" defaultValue={rate ? String(rate.maxWeightGrams / 1000) : ''} aria-label={`Band ${index + 1} weight in kg`} className="w-24" />
                <span className="text-muted">kg costs ₦</span>
                <Input name={`band.${index}.price`} inputMode="decimal" defaultValue={rate ? naira(rate.priceMinor) : ''} aria-label={`Band ${index + 1} price in naira`} className="w-32" />
              </div>
            );
          })}
        </div>
      </fieldset>
      <SubmitButton>{submit}</SubmitButton>
    </ActionForm>
  );
}
