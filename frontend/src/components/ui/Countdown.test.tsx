import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Countdown } from './Countdown';

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('counts down every second and calls onExpire once at zero', () => {
    const onExpire = vi.fn();
    render(<Countdown expiresAt="2026-10-22T12:00:03Z" onExpire={onExpire} />);
    expect(screen.getByRole('timer')).toHaveTextContent('0:03');

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:02');
    expect(onExpire).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
    expect(onExpire).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(5000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Your hold has expired.')).toBeInTheDocument();
  });

  it('expires immediately when the deadline has already passed', () => {
    const onExpire = vi.fn();
    render(<Countdown expiresAt="2026-10-22T11:59:00Z" onExpire={onExpire} />);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
  });

  it('announces when under two minutes remain', () => {
    render(<Countdown expiresAt="2026-10-22T12:02:05Z" />);
    expect(screen.queryByText(/Less than 2 minutes/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText('Less than 2 minutes left to complete your booking.')).toBeInTheDocument();
  });
});
