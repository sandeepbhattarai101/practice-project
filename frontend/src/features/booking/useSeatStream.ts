import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api';
import { bookingApi, bookingKeys } from './api';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'unsupported';

/**
 * Subscribes to GET /api/showtimes/:id/seats/stream and refetches the seat map on `seats-changed`.
 * EventSource reconnects by itself; after a reconnect we also refetch in case we missed events.
 */
export function useSeatStream(showtimeId: number, enabled = true): StreamStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>(typeof EventSource === 'undefined' ? 'unsupported' : 'connecting');
  const hadError = useRef(false);

  useEffect(() => {
    if (!enabled || !Number.isFinite(showtimeId) || typeof EventSource === 'undefined') return;
    const source = new EventSource(apiUrl(bookingApi.seatStreamPath(showtimeId)), { withCredentials: true });
    const refetch = () => qc.invalidateQueries({ queryKey: bookingKeys.seats(showtimeId) });

    source.onopen = () => {
      setStatus('live');
      if (hadError.current) {
        hadError.current = false;
        void refetch();
      }
    };
    source.onerror = () => {
      hadError.current = true;
      setStatus(source.readyState === EventSource.CLOSED ? 'unsupported' : 'reconnecting');
    };
    source.addEventListener('seats-changed', () => {
      void refetch();
    });

    return () => source.close();
  }, [showtimeId, enabled, qc]);

  return status;
}
