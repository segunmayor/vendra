'use client';

import { Alert, Button } from '@vendra/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

const HARD_LIMIT = 100 * 1024 * 1024;
const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Uploads one video with a progress bar. Videos are too large for a Server Action, so the file
 * goes to Admin's streaming upload route, which passes it to the API.
 */
export function VideoUpload({ productId }: { productId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);

  const upload = () => {
    const file = input.current?.files?.[0];
    if (!file) return setMessage({ tone: 'danger', text: 'Choose a video to upload' });
    if (file.size > HARD_LIMIT) return setMessage({ tone: 'danger', text: `That video is ${megabytes(file.size)}. Videos can be up to 100 MB.` });
    const form = new FormData();
    form.set('file', file, file.name);
    const request = new XMLHttpRequest();
    request.open('POST', `/uploads/product-videos/${productId}`);
    request.upload.onprogress = (event) => event.lengthComputable && setProgress(Math.round((event.loaded / event.total) * 100));
    request.onload = () => {
      setProgress(null);
      if (request.status >= 200 && request.status < 300) {
        setMessage({ tone: 'success', text: 'Video added.' });
        if (input.current) input.current.value = '';
        router.refresh();
        return;
      }
      let text = 'The video could not be uploaded.';
      try {
        const body = JSON.parse(request.responseText) as { detail?: string; message?: string };
        text = body.detail ?? body.message ?? text;
      } catch {
        // Not JSON: keep the general message.
      }
      if (request.status === 413) text = 'That video is larger than allowed.';
      setMessage({ tone: 'danger', text });
    };
    request.onerror = () => {
      setProgress(null);
      setMessage({ tone: 'danger', text: 'The upload stopped. Check your connection and try again.' });
    };
    setMessage(null);
    setProgress(0);
    request.send(form);
  };

  return (
    <div className="space-y-3">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Upload a video</span>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov"
          disabled={progress !== null}
          className="block w-full text-sm file:mr-3 file:rounded-brand file:border file:border-border file:bg-surface file:px-3 file:py-1.5"
        />
        <span className="mt-1 block text-xs text-muted">MP4 plays in every browser; MOV and WebM in most. The size limit is set in Settings, under Product videos.</span>
      </label>
      {progress !== null ? (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-background" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Upload progress">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">{progress < 100 ? `Uploading… ${progress}%` : 'Checking and saving…'}</p>
        </div>
      ) : null}
      <Button type="button" size="sm" onClick={upload} disabled={progress !== null}>
        {progress !== null ? 'Uploading…' : 'Upload video'}
      </Button>
    </div>
  );
}
