import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CATALOGUE_STALE_TIME } from '@/lib/queryClient';
import type {
  CinemaCard,
  CinemaDetail,
  CinemaShowtimes,
  City,
  HomeResponse,
  MovieCard,
  MovieDetail,
  MovieFilters,
  MovieShowtimes,
  MovieSort,
  MovieSuggestion,
  MovieWhen,
  Page,
  Promotion,
} from '@/types/api';

export interface MovieListParams {
  city?: string;
  q?: string;
  genre?: string;
  language?: string;
  format?: string;
  cinema?: string;
  when?: MovieWhen;
  date?: string;
  sort?: MovieSort;
  page?: number;
  size?: number;
}

export const catalogKeys = {
  all: ['catalog'] as const,
  cities: () => [...catalogKeys.all, 'cities'] as const,
  home: (city: string) => [...catalogKeys.all, 'home', city] as const,
  movies: (params: MovieListParams) => [...catalogKeys.all, 'movies', params] as const,
  suggest: (q: string, city: string) => [...catalogKeys.all, 'suggest', q, city] as const,
  filters: (city: string) => [...catalogKeys.all, 'filters', city] as const,
  movie: (slug: string) => [...catalogKeys.all, 'movie', slug] as const,
  movieDates: (slug: string, city: string) => [...catalogKeys.all, 'movie', slug, 'dates', city] as const,
  movieShowtimes: (slug: string, city: string, date: string) => [...catalogKeys.all, 'movie', slug, 'showtimes', city, date] as const,
  related: (slug: string) => [...catalogKeys.all, 'movie', slug, 'related'] as const,
  cinemas: (city: string, q: string, format: string) => [...catalogKeys.all, 'cinemas', city, q, format] as const,
  cinema: (slug: string) => [...catalogKeys.all, 'cinema', slug] as const,
  cinemaDates: (slug: string) => [...catalogKeys.all, 'cinema', slug, 'dates'] as const,
  cinemaShowtimes: (slug: string, date: string, movie: string) => [...catalogKeys.all, 'cinema', slug, 'showtimes', date, movie] as const,
  promotions: () => [...catalogKeys.all, 'promotions'] as const,
};

const enc = encodeURIComponent;

export const catalogApi = {
  cities: () => api.get<City[]>('/api/cities'),
  home: (city: string) => api.get<HomeResponse>('/api/home', { city }),
  movies: (params: MovieListParams) => api.get<Page<MovieCard>>('/api/movies', { ...params }),
  suggest: (q: string, city: string, signal?: AbortSignal) => api.get<MovieSuggestion[]>('/api/movies/suggest', { q, city }, signal),
  filters: (city: string) => api.get<MovieFilters>('/api/movies/filters', { city }),
  movie: (slug: string) => api.get<MovieDetail>(`/api/movies/${enc(slug)}`),
  movieDates: (slug: string, city: string) => api.get<string[]>(`/api/movies/${enc(slug)}/dates`, { city }),
  movieShowtimes: (slug: string, city: string, date: string) =>
    api.get<CinemaShowtimes[]>(`/api/movies/${enc(slug)}/showtimes`, { city, date }),
  related: (slug: string) => api.get<MovieCard[]>(`/api/movies/${enc(slug)}/related`),
  cinemas: (city: string, q?: string, format?: string) => api.get<CinemaCard[]>('/api/cinemas', { city, q, format }),
  cinema: (slug: string) => api.get<CinemaDetail>(`/api/cinemas/${enc(slug)}`),
  cinemaDates: (slug: string) => api.get<string[]>(`/api/cinemas/${enc(slug)}/dates`),
  cinemaShowtimes: (slug: string, date: string, movie?: string) =>
    api.get<MovieShowtimes[]>(`/api/cinemas/${enc(slug)}/showtimes`, { date, movie }),
  promotions: () => api.get<Promotion[]>('/api/promotions'),
};

const cached = { staleTime: CATALOGUE_STALE_TIME } as const;

export const useCities = () => useQuery({ queryKey: catalogKeys.cities(), queryFn: catalogApi.cities, staleTime: Infinity });

export const useHome = (city: string) =>
  useQuery({ queryKey: catalogKeys.home(city), queryFn: () => catalogApi.home(city), enabled: Boolean(city), ...cached });

export const useMovies = (params: MovieListParams) =>
  useQuery({
    queryKey: catalogKeys.movies(params),
    queryFn: () => catalogApi.movies(params),
    enabled: Boolean(params.city),
    placeholderData: keepPreviousData,
    ...cached,
  });

export const useMovieSuggestions = (q: string, city: string) =>
  useQuery({
    queryKey: catalogKeys.suggest(q, city),
    queryFn: ({ signal }) => catalogApi.suggest(q, city, signal),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

export const useMovieFilters = (city: string) =>
  useQuery({ queryKey: catalogKeys.filters(city), queryFn: () => catalogApi.filters(city), enabled: Boolean(city), ...cached });

export const useMovie = (slug: string) =>
  useQuery({ queryKey: catalogKeys.movie(slug), queryFn: () => catalogApi.movie(slug), ...cached });

export const useMovieDates = (slug: string, city: string, enabled = true) =>
  useQuery({
    queryKey: catalogKeys.movieDates(slug, city),
    queryFn: () => catalogApi.movieDates(slug, city),
    enabled: enabled && Boolean(city),
    staleTime: 60_000,
  });

export const useMovieShowtimes = (slug: string, city: string, date: string | null) =>
  useQuery({
    queryKey: catalogKeys.movieShowtimes(slug, city, date ?? ''),
    queryFn: () => catalogApi.movieShowtimes(slug, city, date as string),
    enabled: Boolean(city && date),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

export const useRelatedMovies = (slug: string) =>
  useQuery({ queryKey: catalogKeys.related(slug), queryFn: () => catalogApi.related(slug), ...cached });

export const useCinemas = (city: string, q = '', format = '') =>
  useQuery({
    queryKey: catalogKeys.cinemas(city, q, format),
    queryFn: () => catalogApi.cinemas(city, q, format),
    enabled: Boolean(city),
    placeholderData: keepPreviousData,
    ...cached,
  });

export const useCinema = (slug: string) =>
  useQuery({ queryKey: catalogKeys.cinema(slug), queryFn: () => catalogApi.cinema(slug), ...cached });

export const useCinemaDates = (slug: string) =>
  useQuery({ queryKey: catalogKeys.cinemaDates(slug), queryFn: () => catalogApi.cinemaDates(slug), staleTime: 60_000 });

export const useCinemaShowtimes = (slug: string, date: string | null, movie = '') =>
  useQuery({
    queryKey: catalogKeys.cinemaShowtimes(slug, date ?? '', movie),
    queryFn: () => catalogApi.cinemaShowtimes(slug, date as string, movie),
    enabled: Boolean(date),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

export const usePromotions = () =>
  useQuery({ queryKey: catalogKeys.promotions(), queryFn: catalogApi.promotions, ...cached });
