// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ONE_OFFS, VARIANTS } from '../../shared/puzzle';
import { parseHash, useRoute } from './router';

describe('parseHash', () => {
  it('routes #/ and empty/garbage hashes to the archive', () => {
    expect(parseHash('')).toEqual({ screen: 'archive' });
    expect(parseHash('#/')).toEqual({ screen: 'archive' });
    expect(parseHash('#/nonsense')).toEqual({ screen: 'archive' });
    expect(parseHash('#/play/not-a-date')).toEqual({ screen: 'archive' });
  });

  it('routes #/play/<slug> to the game, bare or with any variant suffix', () => {
    expect(parseHash('#/play/2026-07-07')).toEqual({ screen: 'play', slug: '2026-07-07' });
    for (const { suffix } of Object.values(VARIANTS)) {
      expect(parseHash(`#/play/2026-07-07${suffix}`)).toEqual({
        screen: 'play',
        slug: `2026-07-07${suffix}`,
      });
    }
    expect(parseHash('#/play/2026-07-07-sam')).toEqual({ screen: 'archive' });
  });

  it('routes every one-off by its name, and nothing else that is not a date', () => {
    for (const slug of Object.keys(ONE_OFFS)) {
      expect(parseHash(`#/play/${slug}`)).toEqual({ screen: 'play', slug });
    }
    // The alternation is an allow-list, not a shape: a name that is not in
    // `ONE_OFFS` is not a route, however much it looks like one that is. This is
    // the whole of what "reachable only by knowing the name" rests on.
    expect(parseHash('#/play/11x11')).toEqual({ screen: 'archive' });
    expect(parseHash('#/play/10x10-dan')).toEqual({ screen: 'archive' });
  });

  // There was a case here for a suffix that extends another, back when `-dan`
  // and `-dan-long` both existed and the shorter one could swallow the longer.
  // One variant cannot nest with itself, so it went with `dan-long`. The hazard
  // is only dormant, not gone — `router.ts` still sorts the alternation longest
  // first — and a second variant should bring the case back with it.
});

describe('useRoute', () => {
  const ONE_OFF = Object.keys(ONE_OFFS)[0];

  /** Moves the address on without the `hashchange` an in-page link would fire. */
  const silentlyGoTo = (hash: string) => window.history.replaceState(null, '', hash);

  beforeEach(() => silentlyGoTo('#/'));

  it('follows the hash changing under it', async () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ screen: 'archive' });
    await act(async () => {
      window.location.hash = `#/play/${ONE_OFF}`;
      // jsdom queues `hashchange` rather than firing it inline, so the
      // assertion has to wait a turn for it the way a browser would.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current).toEqual({ screen: 'play', slug: ONE_OFF });
  });

  // A phone browser can hand an incoming link to a tab it had put away, which
  // arrives as the page being shown again rather than as the hash changing. Any
  // shared link opened against an already-open tab depends on these two.
  it('catches up on being restored from the back/forward cache', () => {
    const { result } = renderHook(() => useRoute());
    silentlyGoTo(`#/play/${ONE_OFF}`);
    expect(result.current).toEqual({ screen: 'archive' });
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(result.current).toEqual({ screen: 'play', slug: ONE_OFF });
  });

  it('catches up on being switched back to', () => {
    const { result } = renderHook(() => useRoute());
    silentlyGoTo(`#/play/${ONE_OFF}`);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toEqual({ screen: 'play', slug: ONE_OFF });
  });

  // Re-reading on every appearance would otherwise remount the game and lose a
  // half-solved board every time the player glanced at another app.
  it('hands back the very same route when the address has not moved', () => {
    silentlyGoTo(`#/play/${ONE_OFF}`);
    const { result } = renderHook(() => useRoute());
    const before = result.current;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(result.current).toBe(before);
  });
});
