import { describe, expect, it } from 'vitest';
import { ONE_OFFS, VARIANTS } from '../../shared/puzzle';
import { parseHash } from './router';

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
