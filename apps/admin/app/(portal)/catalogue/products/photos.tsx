import { ActionForm, Alert, Badge, Card, Field, Input, SubmitButton } from '@vendra/ui';
import { addPhotoFromUrl, arrangePhotos, uploadPhotos } from './actions';

const MAX_PHOTOS = 10;

const move = (images: readonly string[], from: number, to: number): string[] => {
  const next = [...images];
  const [photo] = next.splice(from, 1);
  if (photo !== undefined) next.splice(to, 0, photo);
  return next;
};

/** Photos on a product page: the first is the main photo, shown on product cards. */
export function Photos({ productId, images, published }: { productId: string; images: readonly string[]; published: boolean }) {
  const room = MAX_PHOTOS - images.length;
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="photos" className="text-lg font-semibold">
          Photos
        </h2>
        <span className="text-sm text-muted">
          {images.length} of {MAX_PHOTOS}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted">The first photo is the main one, shown in search results and on product cards. JPEG, PNG, GIF, WebP or AVIF.</p>

      {images.length === 0 ? (
        <div className="mb-4">
          <Alert tone="warning">{published ? 'This product is live without a photo. Add one so customers can see it.' : 'No photos yet. Add at least one before publishing.'}</Alert>
        </div>
      ) : (
        <ol className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((image, index) => (
            <li key={image} className="space-y-2">
              <div className="relative">
                {/* A plain img: photos are served by this portal at /media/, or are https addresses. */}
                <img src={image} alt={`Photo ${index + 1}`} loading="lazy" className="aspect-square w-full rounded-brand border border-border bg-background object-cover" />
                {index === 0 ? (
                  <span className="absolute top-2 left-2">
                    <Badge tone="success">Main photo</Badge>
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                {index > 0 ? (
                  <ActionForm action={arrangePhotos.bind(null, productId, move(images, index, 0))}>
                    <SubmitButton size="sm" variant="outline" pendingLabel="…" className="h-8 px-2 text-xs">
                      Make main
                    </SubmitButton>
                  </ActionForm>
                ) : null}
                {index > 0 ? (
                  <ActionForm action={arrangePhotos.bind(null, productId, move(images, index, index - 1))}>
                    <SubmitButton size="sm" variant="outline" pendingLabel="…" className="h-8 px-2 text-xs" aria-label={`Move photo ${index + 1} earlier`}>
                      ←
                    </SubmitButton>
                  </ActionForm>
                ) : null}
                {index < images.length - 1 ? (
                  <ActionForm action={arrangePhotos.bind(null, productId, move(images, index, index + 1))}>
                    <SubmitButton size="sm" variant="outline" pendingLabel="…" className="h-8 px-2 text-xs" aria-label={`Move photo ${index + 1} later`}>
                      →
                    </SubmitButton>
                  </ActionForm>
                ) : null}
                <ActionForm action={arrangePhotos.bind(null, productId, images.filter((_, other) => other !== index))}>
                  <SubmitButton size="sm" variant="outline" pendingLabel="Removing…" className="h-8 px-2 text-xs" aria-label={`Remove photo ${index + 1}`}>
                    Remove
                  </SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ol>
      )}

      {room > 0 ? (
        <div className="grid gap-6 border-t border-border pt-4 md:grid-cols-2">
          <ActionForm action={uploadPhotos.bind(null, productId, room)} className="space-y-3">
            <Field label="Upload from this computer" hint={`Choose up to ${room} at once. The size limit is set in Settings, under Product imports.`}>
              <input
                name="files"
                type="file"
                multiple
                required
                accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                className="block w-full text-sm file:mr-3 file:rounded-brand file:border file:border-border file:bg-surface file:px-3 file:py-1.5"
              />
            </Field>
            <SubmitButton size="sm" pendingLabel="Uploading…">
              Upload
            </SubmitButton>
          </ActionForm>
          <ActionForm action={addPhotoFromUrl.bind(null, productId)} className="space-y-3">
            <Field label="Add from a web address" hint="A direct https:// link to the image file. Vendra keeps its own copy.">
              <Input name="url" type="url" required maxLength={2000} placeholder="https://" />
            </Field>
            <SubmitButton size="sm" variant="outline" pendingLabel="Fetching…">
              Add photo
            </SubmitButton>
          </ActionForm>
        </div>
      ) : (
        <p className="border-t border-border pt-4 text-sm text-muted">This product has the most photos allowed. Remove one to add another.</p>
      )}
    </Card>
  );
}
