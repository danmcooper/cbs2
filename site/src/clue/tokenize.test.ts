import { describe, expect, it } from 'vitest';
import { tokenizeClue } from './tokenize';

describe('tokenizeClue', () => {
  it('passes plain text through as one segment', () => {
    expect(tokenizeClue('Nothing to see here')).toEqual([
      { kind: 'text', text: 'Nothing to see here' },
    ]);
  });

  it('tokenizes name and possessive-name references', () => {
    expect(tokenizeClue('Ask #NAME:3 about #NAMES:14 alibi')).toEqual([
      { kind: 'text', text: 'Ask ' },
      { kind: 'name', index: 3, possessive: false },
      { kind: 'text', text: ' about ' },
      { kind: 'name', index: 14, possessive: true },
      { kind: 'text', text: ' alibi' },
    ]);
  });

  it('tokenizes professions, columns, and between-pairs', () => {
    expect(tokenizeClue('The #PROF:coder and two #PROFS:chef in #C:2')).toEqual([
      { kind: 'text', text: 'The ' },
      { kind: 'prof', word: 'coder', plural: false, counted: false },
      { kind: 'text', text: ' and two ' },
      { kind: 'prof', word: 'chef', plural: true, counted: false },
      { kind: 'text', text: ' in ' },
      { kind: 'column', column: 2 },
    ]);
    expect(tokenizeClue('one innocent #BETWEEN:pair(7,11)')).toEqual([
      { kind: 'text', text: 'one innocent ' },
      { kind: 'between', a: 7, b: 11 },
    ]);
  });

  // #PROFN is ours rather than the source's: the renderer emits it when a clue
  // counts one profession's members, and only the site can say how many there
  // are, because only the site has the board.
  it('marks a #PROFN profession as counted so the site fills in the total', () => {
    expect(tokenizeClue('Exactly 1 of #PROFN:cook has')).toEqual([
      { kind: 'text', text: 'Exactly 1 of ' },
      { kind: 'prof', word: 'cook', plural: true, counted: true },
      { kind: 'text', text: ' has' },
    ]);
  });

  it('renders unknown or malformed tokens as raw text', () => {
    expect(tokenizeClue('color #FFF here')).toEqual([
      { kind: 'text', text: 'color ' },
      { kind: 'text', text: '#FFF' },
      { kind: 'text', text: ' here' },
    ]);
    expect(tokenizeClue('#NAME:x')).toEqual([{ kind: 'text', text: '#NAME:x' }]);
    // Malformed pair: the token regex captures only "#BETWEEN:pair", the rest stays literal text.
    expect(tokenizeClue('#BETWEEN:pair(1)')).toEqual([
      { kind: 'text', text: '#BETWEEN:pair' },
      { kind: 'text', text: '(1)' },
    ]);
  });
});
