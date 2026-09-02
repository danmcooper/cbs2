export interface VocabPerson {
  name: string;
  gender: 'male' | 'female';
}

export interface VocabProfession {
  key: string;
  male: string;
  female: string;
}

export const NAMES: VocabPerson[] = [
  { name: 'Ada', gender: 'female' }, { name: 'Bram', gender: 'male' },
  { name: 'Cleo', gender: 'female' }, { name: 'Desmond', gender: 'male' },
  { name: 'Elin', gender: 'female' }, { name: 'Fabio', gender: 'male' },
  { name: 'Greta', gender: 'female' }, { name: 'Hugo', gender: 'male' },
  { name: 'Ines', gender: 'female' }, { name: 'Jonas', gender: 'male' },
  { name: 'Kira', gender: 'female' }, { name: 'Lorenzo', gender: 'male' },
  { name: 'Mira', gender: 'female' }, { name: 'Nils', gender: 'male' },
  { name: 'Odette', gender: 'female' }, { name: 'Piet', gender: 'male' },
  { name: 'Quinn', gender: 'female' }, { name: 'Rafael', gender: 'male' },
  { name: 'Suri', gender: 'female' }, { name: 'Tomas', gender: 'male' },
  { name: 'Ulla', gender: 'female' }, { name: 'Viktor', gender: 'male' },
  { name: 'Wren', gender: 'female' }, { name: 'Xavi', gender: 'male' },
  { name: 'Yara', gender: 'female' }, { name: 'Zeno', gender: 'male' },
  { name: 'Anouk', gender: 'female' }, { name: 'Boris', gender: 'male' },
  { name: 'Carys', gender: 'female' }, { name: 'Dmitri', gender: 'male' },
  { name: 'Esme', gender: 'female' }, { name: 'Ferran', gender: 'male' },
  { name: 'Golda', gender: 'female' }, { name: 'Hamish', gender: 'male' },
  { name: 'Iris', gender: 'female' }, { name: 'Janko', gender: 'male' },
  { name: 'Katia', gender: 'female' }, { name: 'Lucian', gender: 'male' },
  { name: 'Maud', gender: 'female' }, { name: 'Novak', gender: 'male' },
  { name: 'Orla', gender: 'female' }, { name: 'Pavel', gender: 'male' },
  { name: 'Rosa', gender: 'female' }, { name: 'Stefan', gender: 'male' },
  // A third pass through the alphabet, to cover the largest board a generated
  // puzzle can draw: 7x7 is 49 cards, and every card needs its own name.
  { name: 'Tessa', gender: 'female' }, { name: 'Ulrich', gender: 'male' },
  { name: 'Vera', gender: 'female' }, { name: 'Wim', gender: 'male' },
  { name: 'Xenia', gender: 'female' }, { name: 'Yusuf', gender: 'male' },
  { name: 'Zola', gender: 'female' }, { name: 'Anton', gender: 'male' },
];

/** Keys and emoji taken from the profession face map the site already ships
 * (`site/src/faces.ts`); each pluralises with a plain -s. */
export const PROFESSIONS: VocabProfession[] = [
  { key: 'cop', male: '👮‍♂️', female: '👮‍♀️' },
  { key: 'sleuth', male: '🕵️‍♂️', female: '🕵️‍♀️' },
  { key: 'guard', male: '💂‍♂️', female: '💂‍♀️' },
  { key: 'builder', male: '👷‍♂️', female: '👷‍♀️' },
  { key: 'farmer', male: '👨‍🌾', female: '👩‍🌾' },
  { key: 'cook', male: '👨‍🍳', female: '👩‍🍳' },
  { key: 'doctor', male: '👨‍⚕️', female: '👩‍⚕️' },
  { key: 'clerk', male: '👨‍💼', female: '👩‍💼' },
  { key: 'coder', male: '👨‍💻', female: '👩‍💻' },
  { key: 'singer', male: '👨‍🎤', female: '👩‍🎤' },
  { key: 'teacher', male: '👨‍🏫', female: '👩‍🏫' },
  { key: 'painter', male: '👨‍🎨', female: '👩‍🎨' },
  { key: 'pilot', male: '👨‍✈️', female: '👩‍✈️' },
  { key: 'judge', male: '👨‍⚖️', female: '👩‍⚖️' },
  { key: 'mechanic', male: '👨‍🔧', female: '👩‍🔧' },
  { key: 'student', male: '👨‍🎓', female: '👩‍🎓' },
];

/**
 * Held back for the boards that actually need them. Sixteen professions covers
 * every board size on its own, but from eighteen cards up the widest cast uses
 * all of them, so a 7x7 runs three-to-a-profession and leans on the same
 * profession clue over and over. Adding these to every board would change the
 * feel of the archive-sized ones for no reason, so `professionsFor` only deals
 * them in above the source site's own twenty cards.
 *
 * All of them are in `site/src/faces.ts` too, so a file that predates them
 * still renders.
 */
export const EXTRA_PROFESSIONS: VocabProfession[] = [
  { key: 'scientist', male: '👨‍🔬', female: '👩‍🔬' },
  { key: 'firefighter', male: '👨‍🚒', female: '👩‍🚒' },
  { key: 'astronaut', male: '👨‍🚀', female: '👩‍🚀' },
  { key: 'ninja', male: '🥷', female: '🥷' },
  { key: 'superhero', male: '🦸‍♂️', female: '🦸' },
];

/** Every profession that can appear in a file, for lookups like `faceOf`. */
export const ALL_PROFESSIONS: VocabProfession[] = [...PROFESSIONS, ...EXTRA_PROFESSIONS];

/**
 * The board the source site ships is 4x5. At or below that, the cast is drawn
 * from exactly the professions it always was; above it, the wider set.
 */
export const BASE_PROFESSION_LIMIT = 20;

/** The professions a board of `size` cards may draw from. */
export function professionsFor(size: number): VocabProfession[] {
  return size > BASE_PROFESSION_LIMIT ? ALL_PROFESSIONS : PROFESSIONS;
}

export function faceOf(profession: string, gender: 'male' | 'female'): string {
  const entry = ALL_PROFESSIONS.find((p) => p.key === profession);
  if (!entry) return '😬';
  return gender === 'female' ? entry.female : entry.male;
}

export const TITLES: string[] = [
  'The Lantern Street Lineup',
  'Twenty Faces, Five Lies',
  'A Quiet Morning at the Depot',
  'Nobody Left the Courtyard',
  'The Ferry Was Late',
  'Someone Signed the Ledger Twice',
  'Four Rows, One Confession',
  'The Greenhouse Roster',
  'Names Called at Dawn',
  'The Second Shift',
  'Everyone Says They Were Reading',
  'A Draft in the Archive Room',
  'The Bell Rang Anyway',
  'Chalk Marks on the Platform',
  'Whose Coat Is on the Hook',
  'The Corner Table Knows',
  'Nine Alibis and a Gap',
  'Sunday Inventory',
  'The Stairwell Census',
  'One Story Does Not Fit',
  'The Kettle Was Still Warm',
  'Line Up by the Fence',
];

export const FLAVOUR: string[] = [
  'I was tying my shoelace the whole time.',
  'I only work weekends, so ask someone on shift.',
  'I have nothing useful to add, sorry.',
  'Ask someone with a better view.',
  'I was facing the other way.',
  'My glasses were in my pocket.',
  'I heard something, but that is all.',
  'I keep out of other people’s business.',
  'You will have to ask the others.',
  'I lost track of everyone after lunch.',
  'It was too loud to notice anything.',
  'I had my hands full at the time.',
  'I only just got here myself.',
  'I never remember faces.',
  'I was counting crates, not people.',
  'Somebody moved my chair, that is all I know.',
  'I would rather not guess.',
  'Nothing to report from where I stood.',
  'I was halfway out the door.',
  'My shift had already ended.',
  'I was looking for my keys.',
  'The window was fogged over.',
  'I stepped outside for some air.',
  'I was on the phone with my sister.',
  'Everyone looks the same in that light.',
  'I did not check the clock once.',
  'I stayed where I was told to stay.',
  'I was reading the noticeboard.',
  'I had a headache and closed my eyes.',
  'The kettle needed watching.',
  'I was sorting the post.',
  'I could not hear a thing over the fan.',
];
