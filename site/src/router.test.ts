import { describe, expect, it } from 'vitest';
import { VARIANTS } from '../../shared/puzzle';
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

  // There was a case here for a suffix that extends another, back when `-dan`
  // and `-dan-long` both existed and the shorter one could swallow the longer.
  // One variant cannot nest with itself, so it went with `dan-long`. The hazard
  // is only dormant, not gone — `router.ts` still sorts the alternation longest
  // first — and a second variant should bring the case back with it.
});
