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

  // The suffixes nest — `-dan` is a prefix of `-dan-long` — so a pattern that
  // takes the shorter one first has to be able to give it back.
  it('routes a suffix that extends another', () => {
    expect(parseHash('#/play/2026-07-07-dan-long')).toEqual({
      screen: 'play',
      slug: '2026-07-07-dan-long',
    });
  });
});
