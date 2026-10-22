import type { MovieStatus } from '@/types/api';

/** The contract does not enumerate movie statuses; these are the values the admin UI offers. */
export const MOVIE_STATUSES: MovieStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

/** The contract does not enumerate cinema statuses; ACTIVE / INACTIVE is an assumption. */
export const CINEMA_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export const FACILITY_SUGGESTIONS = ['Parking', 'Food court', 'Wheelchair access', '3D', 'IMAX', 'Dolby Atmos', 'Recliners', 'Online ordering'];

export const FORMAT_SUGGESTIONS = ['2D', '3D', 'IMAX', '4DX', 'Dolby Atmos'];

export const LANGUAGE_SUGGESTIONS = ['Nepali', 'English', 'Hindi', 'Korean', 'Japanese', 'Tamil', 'Telugu'];

export const GENRE_SUGGESTIONS = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama', 'Family', 'Fantasy', 'Horror', 'Romance', 'Sci-Fi', 'Thriller'];

export const TIMEZONE_SUGGESTIONS = [
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Thimphu',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
];

export function titleCase(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}
