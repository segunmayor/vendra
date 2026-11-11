import { ActionForm, SubmitButton } from '@vendra/ui';
import Link from 'next/link';
import { addItem } from '../app/cart/actions';

/** Quantity and add-to-basket for one option. Works without JavaScript. */
export function AddToCart({ listingId, max, disabled }: { listingId: string; max: number; disabled: boolean }) {
  if (disabled) {
    return <p className="mt-6 rounded-brand border border-border bg-surface px-4 py-3 text-sm text-muted">This option is out of stock.</p>;
  }
  const options = Array.from({ length: Math.max(1, Math.min(10, max)) }, (_, index) => index + 1);
  return (
    <div className="mt-6">
      <ActionForm action={addItem} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="listingId" value={listingId} />
        <label className="text-sm">
          <span className="mb-1 block font-medium">Quantity</span>
          <select name="quantity" defaultValue="1" className="h-12 rounded-brand border border-border bg-surface px-3 text-base">
            {options.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton size="lg" variant="accent" className="flex-1 sm:flex-none sm:px-10" pendingLabel="Adding…">
          Add to basket
        </SubmitButton>
      </ActionForm>
      <Link href="/cart" className="mt-3 inline-block text-sm font-semibold text-primary underline">
        View basket
      </Link>
    </div>
  );
}
