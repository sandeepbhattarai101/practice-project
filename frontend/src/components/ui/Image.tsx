import { useState, type ImgHTMLAttributes } from 'react';
import { ImageOff } from 'lucide-react';
import { assetUrl } from '@/lib/media';
import { cn } from '@/lib/cn';

type Ratio = 'poster' | 'backdrop' | 'wide' | 'square' | 'none';

const ratios: Record<Ratio, string> = {
  poster: 'aspect-[2/3]',
  backdrop: 'aspect-video',
  wide: 'aspect-[21/9]',
  square: 'aspect-square',
  none: '',
};

const dims: Record<Ratio, { width: number; height: number }> = {
  poster: { width: 400, height: 600 },
  backdrop: { width: 1280, height: 720 },
  wide: { width: 1680, height: 720 },
  square: { width: 400, height: 400 },
  none: { width: 400, height: 300 },
};

/**
 * An image in a fixed-ratio box so layout never shifts while it loads. Lazy by default;
 * pass `priority` for the hero. Falls back to a quiet placeholder when the URL fails.
 */
export function Img({
  src,
  alt,
  ratio = 'poster',
  priority = false,
  className,
  imgClassName,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | null | undefined;
  alt: string;
  ratio?: Ratio;
  priority?: boolean;
  imgClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = assetUrl(src);
  return (
    <div className={cn('relative overflow-hidden bg-elevated', ratios[ratio], className)}>
      {resolved && !failed ? (
        <img
          src={resolved}
          alt={alt}
          width={dims[ratio].width}
          height={dims[ratio].height}
          loading={priority ? 'eager' : 'lazy'}
          decoding={priority ? 'sync' : 'async'}
          fetchPriority={priority ? 'high' : undefined}
          onError={() => setFailed(true)}
          className={cn('absolute inset-0 h-full w-full object-cover', imgClassName)}
          {...rest}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-subtle" role={alt ? 'img' : undefined} aria-label={alt || undefined}>
          <ImageOff className="size-6" aria-hidden />
        </div>
      )}
    </div>
  );
}
