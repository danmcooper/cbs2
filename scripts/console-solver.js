/**
 * Paste-into-the-console solver for the player in `site/`.
 *
 * Every puzzle file ships the answer: each person carries `criminal`, and
 * `paths` records sufficient sets of cards for deducing them. So this needs no
 * solving of its own — it reads `puzzles/<slug>.json` for whatever is open and
 * either prints the answer or plays it.
 *
 * Open a puzzle (`#/play/2026-09-02`), paste this whole file into the console,
 * then:
 *
 *   cbs.show()              print the solution grid and a per-card table
 *   cbs.spoil('D3')         one card, by grid label, name, or index
 *   cbs.auto()              play it out in the UI, one card a second
 *   cbs.auto({interval: 0}) the same, as fast as React will re-render
 *   cbs.json()              the raw puzzle object
 *
 * `auto` drives the real buttons, so the game's own rules apply: it only calls
 * a card the flipped clues already justify (`isDeducible` in
 * `site/src/game/deduce.ts` rejects a correct answer that is not yet earned),
 * and it flips in waves until every card is down. State saves through the
 * app's own reducer, so the result screen and the timer are the genuine ones.
 */
(() => {
  const base = location.pathname.replace(/[^/]*$/, "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const slugOf = () => {
    const m = location.hash.match(/^#\/play\/([^/?]+)/);
    if (!m) throw new Error("Open a puzzle first (the address should look like #/play/2026-09-02).");
    return m[1];
  };

  const cache = new Map();
  async function load() {
    const slug = slugOf();
    if (!cache.has(slug)) {
      const res = await fetch(`${base}puzzles/${slug}.json`);
      if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
      cache.set(slug, await res.json());
    }
    return cache.get(slug);
  }

  // Matches the corner labels on the cards (`gridLabel` in clue/ClueText.tsx).
  const label = (i, width) => `${String.fromCharCode(65 + (i % width))}${Math.floor(i / width) + 1}`;

  const cards = () => [...document.querySelectorAll(".grid .card-container .card")];
  const flippedSet = () =>
    new Set(cards().flatMap((el, i) => (el.classList.contains("flipped") ? [i] : [])));

  /**
   * The paths half of the app's `isDeducible`: a recorded sufficient set that
   * is fully flipped settles the card. The other half (`forcedGiven`) is a
   * solver call this script has no way to make, so a card the paths miss is
   * left to the fallback in `auto` — the app itself will still allow it if the
   * clues force it.
   */
  const pathReady = (person, flipped) =>
    person.paths === null || person.paths.some((p) => p.every((i) => flipped.has(i)));

  const dialog = (name) => document.querySelector(`[role="dialog"][aria-label="${name}"]`);

  async function dismissOverlays() {
    document.querySelector(".start-modal .btn-start")?.click();
    document.querySelector('button[aria-label="Unpause"]')?.click();
    await sleep(0);
  }

  function summarize(puzzle) {
    const rows = puzzle.people.map((p, i) => ({
      "#": i,
      at: label(i, puzzle.width),
      name: p.name,
      profession: p.profession,
      verdict: p.criminal ? "CRIMINAL" : "innocent",
    }));
    const grid = [];
    for (let y = 0; y < puzzle.height; y++) {
      grid.push(
        puzzle.people
          .slice(y * puzzle.width, (y + 1) * puzzle.width)
          .map((p) => (p.criminal ? "X" : "."))
          .join(" "),
      );
    }
    return { rows, grid };
  }

  const api = {
    json: load,

    /** The whole answer: an X/. map, then a table of every card. */
    async show() {
      const puzzle = await load();
      const { rows, grid } = summarize(puzzle);
      const crooks = puzzle.people.filter((p) => p.criminal).length;
      console.log(
        `%c${puzzle.title ?? slugOf()}%c  ${puzzle.width}x${puzzle.height} · ${puzzle.difficulty} · ${crooks} criminal${crooks === 1 ? "" : "s"}`,
        "font-weight:bold",
        "color:gray",
      );
      console.log(`X = criminal\n${grid.join("\n")}`);
      console.table(rows);
      return rows;
    },

    /** One card, by grid label ("D3"), name ("austin"), or index. */
    async spoil(who) {
      const puzzle = await load();
      const key = String(who).toLowerCase();
      const i = puzzle.people.findIndex(
        (p, n) => String(n) === key || p.name.toLowerCase() === key || label(n, puzzle.width).toLowerCase() === key,
      );
      if (i < 0) throw new Error(`No card matches ${JSON.stringify(who)}.`);
      const p = puzzle.people[i];
      const verdict = `${p.name} (${label(i, puzzle.width)}) is ${p.criminal ? "CRIMINAL" : "innocent"}`;
      console.log(verdict);
      return verdict;
    },

    /**
     * Play the puzzle through the UI.
     *
     * Flips in waves: every card the flipped clues already justify, then round
     * again with those clues on the table. When a wave finds nothing — the
     * recorded paths are a sample, not an enumeration, so this happens — it
     * offers the remaining cards one at a time and lets the app's own solver
     * rule on them. A card the app rejects is a mistake on the scoreboard, so
     * the fallback stops at the first one rather than grinding through.
     *
     * `interval` is the pace: one card a second by default, measured card to
     * card, so a board reads at about the speed you would play it rather than
     * blinking to solved. The modal steps inside a card are quick regardless —
     * the wait is what is left of the second once the card is down.
     */
    async auto({ interval = 1000, step = 60, dryRun = false } = {}) {
      const puzzle = await load();
      if (cards().length !== puzzle.people.length) {
        throw new Error("The board on screen does not match the loaded puzzle. Reload and retry.");
      }
      await dismissOverlays();

      let flipped = flippedSet();
      let mistakes = 0;
      const start = flipped.size;

      while (flipped.size < puzzle.people.length) {
        const wave = puzzle.people
          .map((p, i) => i)
          .filter((i) => !flipped.has(i) && pathReady(puzzle.people[i], flipped));
        // Nothing recorded as ready: fall back to a single speculative call.
        const queue = wave.length ? wave : [[...Array(puzzle.people.length).keys()].find((i) => !flipped.has(i))];

        if (dryRun) {
          console.log(
            wave.length ? `wave of ${queue.length}: ${queue.map((i) => label(i, puzzle.width)).join(", ")}` : `stalled; would try ${label(queue[0], puzzle.width)}`,
          );
          queue.forEach((i) => flipped.add(i));
          continue;
        }

        for (const i of queue) {
          if (flipped.has(i)) continue;
          const began = Date.now();
          const person = puzzle.people[i];
          cards()[i].click();
          await sleep(step);
          const modal = dialog(person.name);
          if (!modal) throw new Error(`The guess modal for ${person.name} did not open.`);
          modal.querySelector(person.criminal ? ".btn-criminal" : ".btn-innocent")?.click();
          await sleep(step);
          const rejected = dialog("not enough evidence");
          if (rejected) {
            mistakes++;
            rejected.querySelector(".btn-continue")?.click();
            await sleep(step);
            if (!wave.length) {
              console.warn(
                `Stopped: ${person.name} (${label(i, puzzle.width)}) is not deducible yet, and nothing else was ready. ${flipped.size}/${puzzle.people.length} flipped.`,
              );
              return { flipped: flipped.size, of: puzzle.people.length, mistakes, done: false };
            }
          }
          // Hold the card-to-card pace, less whatever the modals just took.
          await sleep(Math.max(0, interval - (Date.now() - began)));
        }

        const next = flippedSet();
        if (next.size === flipped.size) {
          console.warn(`Stopped: no progress at ${flipped.size}/${puzzle.people.length} flipped.`);
          return { flipped: flipped.size, of: puzzle.people.length, mistakes, done: false };
        }
        flipped = next;
      }

      console.log(
        `Solved: ${flipped.size - start} cards flipped, ${mistakes} mistake${mistakes === 1 ? "" : "s"}.`,
      );
      return { flipped: flipped.size, of: puzzle.people.length, mistakes, done: true };
    },
  };

  window.cbs = api;
  console.log("%ccbs%c ready — cbs.show(), cbs.spoil('D3'), cbs.auto()", "font-weight:bold", "color:gray");
})();
