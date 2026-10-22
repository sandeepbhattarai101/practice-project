import { ExternalLink } from 'lucide-react';
import { Dialog } from '@/components/ui';
import { youtubeEmbedUrl } from '@/lib/media';

/** Trailer in an accessible modal. YouTube links use the privacy-enhanced youtube-nocookie embed. */
export function TrailerDialog({ open, onClose, title, url }: { open: boolean; onClose: () => void; title: string; url: string | null }) {
  const embed = youtubeEmbedUrl(url);
  return (
    <Dialog open={open} onClose={onClose} title={`${title} — trailer`} hideTitle variant="media">
      {embed ? (
        <div className="aspect-video w-full">
          <iframe
            src={embed}
            title={`${title} trailer`}
            className="h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : url ? (
        <div className="grid aspect-video w-full place-items-center p-8 text-center">
          <div>
            <p className="text-muted">This trailer is hosted elsewhere.</p>
            <a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 font-semibold text-accent hover:underline">
              Open the trailer <ExternalLink className="size-4" aria-hidden />
            </a>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
