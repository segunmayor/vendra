import { ActionForm, Badge, Card, SubmitButton } from '@vendra/ui';
import { arrangeVideos } from './actions';
import { VideoUpload } from './video-upload';

const move = (videos: readonly string[], from: number, to: number): string[] => {
  const next = [...videos];
  const [video] = next.splice(from, 1);
  if (video !== undefined) next.splice(to, 0, video);
  return next;
};

/** Videos on a product page, shown under the photos in the Store. */
export function Videos({ productId, videos, limit }: { productId: string; videos: readonly string[]; limit: number }) {
  const room = Math.max(0, limit - videos.length);
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="videos" className="text-lg font-semibold">
          Videos
        </h2>
        <span className="text-sm text-muted">
          {videos.length} of {limit}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted">Shown on the product page under the photos, in this order. Short clips work best.</p>

      {videos.length ? (
        <ol className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video, index) => (
            <li key={video} className="space-y-2">
              <div className="relative">
                <video src={video} controls preload="metadata" playsInline className="aspect-video w-full rounded-brand border border-border bg-black" aria-label={`Video ${index + 1}`} />
                {index === 0 ? (
                  <span className="absolute top-2 left-2">
                    <Badge tone="success">First</Badge>
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                {index > 0 ? (
                  <ActionForm action={arrangeVideos.bind(null, productId, move(videos, index, index - 1))}>
                    <SubmitButton size="sm" variant="outline" pendingLabel="…" className="h-8 px-2 text-xs" aria-label={`Move video ${index + 1} earlier`}>
                      ←
                    </SubmitButton>
                  </ActionForm>
                ) : null}
                {index < videos.length - 1 ? (
                  <ActionForm action={arrangeVideos.bind(null, productId, move(videos, index, index + 1))}>
                    <SubmitButton size="sm" variant="outline" pendingLabel="…" className="h-8 px-2 text-xs" aria-label={`Move video ${index + 1} later`}>
                      →
                    </SubmitButton>
                  </ActionForm>
                ) : null}
                <ActionForm action={arrangeVideos.bind(null, productId, videos.filter((_, other) => other !== index))}>
                  <SubmitButton size="sm" variant="outline" pendingLabel="Removing…" className="h-8 px-2 text-xs" aria-label={`Remove video ${index + 1}`}>
                    Remove
                  </SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {limit === 0 ? (
        <p className="border-t border-border pt-4 text-sm text-muted">Product videos are turned off in Settings, under Product videos.</p>
      ) : room > 0 ? (
        <div className="max-w-md border-t border-border pt-4">
          <VideoUpload productId={productId} />
        </div>
      ) : (
        <p className="border-t border-border pt-4 text-sm text-muted">This product has the most videos allowed. Remove one to add another.</p>
      )}
    </Card>
  );
}
