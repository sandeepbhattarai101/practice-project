import { afterEach, describe, expect, it } from 'vitest';
import { youtubeEmbedUrl } from './media';
import { buildIcs } from './ics';
import { getPaymentAttemptKey, rememberPaymentAttempt, resetFailedAttempts } from './idempotency';
import { safeNext } from '@/app/guards';
import { followPaymentRedirect } from '@/features/checkout/redirect';

describe('youtubeEmbedUrl', () => {
  it('maps YouTube URLs to youtube-nocookie embeds', () => {
    expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
    expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=3')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
    expect(youtubeEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toContain('/embed/dQw4w9WgXcQ');
  });
  it('returns null for other URLs', () => {
    expect(youtubeEmbedUrl('https://vimeo.com/123')).toBeNull();
    expect(youtubeEmbedUrl('not a url')).toBeNull();
    expect(youtubeEmbedUrl(null)).toBeNull();
  });
});

describe('buildIcs', () => {
  it('produces a VEVENT with UTC times and escaped text', () => {
    const ics = buildIcs(
      { uid: 'PP1@pp', title: 'Film, the sequel', start: '2026-10-22T12:45:00Z', end: '2026-10-22T15:00:00Z', location: 'Cinema; Screen 1' },
      new Date('2026-10-01T00:00:00Z'),
    );
    expect(ics).toContain('DTSTART:20261022T124500Z');
    expect(ics).toContain('DTEND:20261022T150000Z');
    expect(ics).toContain('SUMMARY:Film\\, the sequel');
    expect(ics).toContain('LOCATION:Cinema\\; Screen 1');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

describe('payment idempotency keys', () => {
  afterEach(() => sessionStorage.clear());

  it('reuses the key for the same booking + provider', () => {
    const a = getPaymentAttemptKey('REF1', 'ESEWA');
    expect(getPaymentAttemptKey('REF1', 'ESEWA')).toBe(a);
    expect(getPaymentAttemptKey('REF1', 'KHALTI')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('starts a fresh attempt after the payment it created failed', () => {
    const a = getPaymentAttemptKey('REF2', 'ESEWA');
    rememberPaymentAttempt('REF2', 'ESEWA', 77);
    resetFailedAttempts('REF2', [{ id: 77, provider: 'ESEWA', status: 'PENDING' }]);
    expect(getPaymentAttemptKey('REF2', 'ESEWA')).toBe(a);
    resetFailedAttempts('REF2', [{ id: 77, provider: 'ESEWA', status: 'FAILED' }]);
    expect(getPaymentAttemptKey('REF2', 'ESEWA')).not.toBe(a);
  });
});

describe('safeNext', () => {
  it('only allows same-site paths', () => {
    expect(safeNext('/checkout/ABC?x=1')).toBe('/checkout/ABC?x=1');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext(null, '/account')).toBe('/account');
  });
});

describe('followPaymentRedirect', () => {
  it('builds and submits a hidden form for POST redirects', () => {
    const submitted: HTMLFormElement[] = [];
    const original = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function submit(this: HTMLFormElement) {
      submitted.push(this);
    };
    try {
      followPaymentRedirect({ method: 'POST', url: 'https://gateway.example/pay', fields: { amount: '847.50', ref: 'PP7K2Q' } });
    } finally {
      HTMLFormElement.prototype.submit = original;
    }
    expect(submitted).toHaveLength(1);
    const form = submitted[0];
    expect(form.method).toBe('post');
    expect(form.action).toBe('https://gateway.example/pay');
    const fields = Object.fromEntries(Array.from(form.querySelectorAll('input')).map((i) => [i.name, i.value]));
    expect(fields).toEqual({ amount: '847.50', ref: 'PP7K2Q' });
    expect(form.querySelectorAll('input[type="hidden"]')).toHaveLength(2);
    form.remove();
  });
});
