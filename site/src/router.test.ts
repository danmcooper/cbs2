import { describe, expect, it } from 'vitest';
import { parseHash } from './router';

describe('parseHash', () => {
  it('routes #/ and empty/garbage hashes to the archive', () => {
    expect(parseHash('')).toEqual({ screen: 'archive' });
    expect(parseHash('#/')).toEqual({ screen: 'archive' });
    expect(parseHash('#/nonsense')).toEqual({ screen: 'archive' });
    expect(parseHash('#/play/not-a-date')).toEqual({ screen: 'archive' });
  });

  it('routes #/play/<slug> to the game, with or without the -dan suffix', () => {
    expect(parseHash('#/play/2026-07-07')).toEqual({ screen: 'play', slug: '2026-07-07' });
    expect(parseHash('#/play/2026-07-07-dan')).toEqual({ screen: 'play', slug: '2026-07-07-dan' });
    expect(parseHash('#/play/2026-07-07-sam')).toEqual({ screen: 'archive' });
  });
});
