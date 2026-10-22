// One-off helper: snapshot QFX Cinemas' PUBLIC "now showing" list into a local seed file,
// so development data uses real current titles and poster links.
//
//   node scripts/import-qfx-catalogue.mjs
//
// What it stores: titles, synopsis, runtime, languages, genres, rating, release date,
// director/cast names, trailer links and the poster *URL* (images stay on QFX's CDN;
// nothing is downloaded or redistributed).
//
// Important:
//  - Posters and synopses are copyrighted (studios / QFX). This is for LOCAL learning only.
//    Do not deploy this data publicly. For a real product use a licensed source such as
//    TMDB (built in: Admin > Movies > Import from TMDB) or the distributor's press kit.
//  - Only the openly served listing endpoint is used. Endpoints that require authorisation
//    are deliberately not touched.
//  - Showtimes in Practice Project are still generated sample data, not QFX's schedule.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../backend/src/main/resources/seed/qfx-now-showing.json');
const url = 'https://web-api.qfxcinemas.com/api/v3/external/now-showing-movies';

const res = await fetch(url, { headers: { 'User-Agent': 'practice-project-seed/1.0 (local development)' } });
if (!res.ok) throw new Error(`QFX listing returned HTTP ${res.status}`);
const body = await res.json();
const rows = body?.Records?.data ?? [];

const certification = (rating) => ({ Adult: 'A', PG: 'PG', U: 'U' })[rating] ?? (rating || 'PG');
const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const slugify = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const movies = new Map();
for (const r of rows) {
  if (movies.has(r.movie_id)) continue;
  const content = (r.languageSpecificImages ?? r.altMovieContent ?? [])[0] ?? {};
  const poster = content.artwork && /^https:\/\//.test(content.artwork) ? content.artwork : null;
  if (!poster) continue; // a card without a picture defeats the point
  const crew = r.castCrewDetails ?? [];
  const names = (title) => (crew.find((c) => c.crew_title === title)?.Crew ?? []).map((c) => clean(c.mcc_cast_name)).filter(Boolean);
  const languages = [...new Set(String(r.lang_names ?? r.lang_name ?? '').split(',').map((l) => clean(l)).filter(Boolean))];
  const trailer = (r.trailer_array ?? []).map((t) => t.mt_link).find((l) => /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(l ?? ''));
  movies.set(r.movie_id, {
    slug: slugify(r.movie_title),
    title: clean(r.movie_title),
    synopsis: clean(content.mc_plot) || clean(content.mc_plot_short),
    runtimeMinutes: Number(r.mrrdr_runtime) || 120,
    releaseDate: r.original_release_date || r.mrrdr_release_date,
    certification: certification(r.rating),
    languages: languages.length ? languages : ['English'],
    genres: String(r.genre_name ?? '').split(',').map(clean).filter(Boolean),
    director: names('Director')[0] ?? null,
    cast: names('Actor').slice(0, 8),
    trailerUrl: trailer ?? null,
    posterUrl: poster,
  });
}

const list = [...movies.values()];
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({
  source: url,
  fetchedAt: new Date().toISOString(),
  notice: 'Snapshot of QFX Cinemas public listing for LOCAL development only. Posters are hotlinked, copyrighted, not redistributed.',
  movies: list,
}, null, 2) + '\n');
console.log(`Wrote ${list.length} movies to ${out}`);
