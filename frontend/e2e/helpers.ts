import type { APIRequestContext } from '@playwright/test';

type Chip = { id: number; salesOpen: boolean; seatsAvailable: number };

/** Finds a now-showing movie with an open show, so the tests work with whatever catalogue is seeded. */
export async function findBookableShow(request: APIRequestContext, skip = 0): Promise<{ slug: string; title: string; showtimeId: number }> {
  const movies = (await (await request.get('/api/movies?when=now&size=50')).json()).items as { slug: string; title: string }[];
  let found = 0;
  for (const movie of movies) {
    const dates = (await (await request.get(`/api/movies/${movie.slug}/dates`)).json()) as string[];
    for (const date of dates) {
      const groups = (await (await request.get(`/api/movies/${movie.slug}/showtimes?date=${date}`)).json()) as { showtimes: Chip[] }[];
      const chip = groups.flatMap((g) => g.showtimes).find((s) => s.salesOpen && s.seatsAvailable > 10);
      if (chip) {
        if (found++ === skip) return { slug: movie.slug, title: movie.title, showtimeId: chip.id };
        break;
      }
    }
  }
  throw new Error('No bookable show found: is the backend seeded and running?');
}
