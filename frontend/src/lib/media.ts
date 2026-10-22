/** Turns a YouTube watch/short URL into a privacy-enhanced embed URL; null for anything else. */
export function youtubeEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = parsed.pathname.slice(1).split('/')[0] || null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') id = parsed.searchParams.get('v');
    else {
      const m = /^\/(?:embed|shorts|v)\/([^/?#]+)/.exec(parsed.pathname);
      id = m ? m[1] : null;
    }
  }
  if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
}

/** Resolves an API-relative asset URL (e.g. /api/media/...) against the API base. */
export function assetUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:')) return url;
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
  return url.startsWith('/api') ? `${base}${url}` : url;
}
