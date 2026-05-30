/**
 * Static canonical book table (Protestant 66-book canon, ESV ordering).
 *
 * Used to (a) assign each book a stable `ordinal` for packed verse ids and
 * (b) parse free-text references by matching against `aliases`. We deliberately
 * store per-book CHAPTER counts only (66 numbers, easy to keep correct) and NOT
 * per-chapter verse counts (~1,189 numbers, error-prone): whole-chapter ranges
 * use a verse sentinel instead (see reference.ts), which is sufficient for the
 * overlap math the alignment engine needs.
 */
export interface BibleBook {
  readonly ordinal: number;
  readonly name: string;
  /**
   * Compact display name (SBL Handbook of Style 2nd ed.). Used by the cross-
   * reference chip's canonical form so a chip in prose reads as `Gen 1:1`
   * rather than `Genesis 1:1`. Books whose names are already ≤ 4 letters
   * (John, Mark, Luke, Acts, Ruth, Job, Joel, Amos, Jude, …) stay full.
   */
  readonly short: string;
  readonly chapters: number;
  readonly aliases: readonly string[];
}

export const BOOKS: readonly BibleBook[] = [
  {
    ordinal: 1,
    name: "Genesis",
    short: "Gen",
    chapters: 50,
    aliases: ["gen", "ge", "gn"],
  },
  {
    ordinal: 2,
    name: "Exodus",
    short: "Exod",
    chapters: 40,
    aliases: ["exod", "exo", "ex"],
  },
  {
    ordinal: 3,
    name: "Leviticus",
    short: "Lev",
    chapters: 27,
    aliases: ["lev", "lv"],
  },
  {
    ordinal: 4,
    name: "Numbers",
    short: "Num",
    chapters: 36,
    aliases: ["num", "nm", "nu"],
  },
  {
    ordinal: 5,
    name: "Deuteronomy",
    short: "Deut",
    chapters: 34,
    aliases: ["deut", "dt"],
  },
  {
    ordinal: 6,
    name: "Joshua",
    short: "Josh",
    chapters: 24,
    aliases: ["josh", "jos"],
  },
  {
    ordinal: 7,
    name: "Judges",
    short: "Judg",
    chapters: 21,
    aliases: ["judg", "jdg", "jgs"],
  },
  {
    ordinal: 8,
    name: "Ruth",
    short: "Ruth",
    chapters: 4,
    aliases: ["ru", "rth"],
  },
  {
    ordinal: 9,
    name: "1 Samuel",
    short: "1 Sam",
    chapters: 31,
    aliases: ["1sam", "1sa", "1sm", "1s"],
  },
  {
    ordinal: 10,
    name: "2 Samuel",
    short: "2 Sam",
    chapters: 24,
    aliases: ["2sam", "2sa", "2sm", "2s"],
  },
  {
    ordinal: 11,
    name: "1 Kings",
    short: "1 Kgs",
    chapters: 22,
    aliases: ["1kings", "1kgs", "1ki", "1kg"],
  },
  {
    ordinal: 12,
    name: "2 Kings",
    short: "2 Kgs",
    chapters: 25,
    aliases: ["2kings", "2kgs", "2ki", "2kg"],
  },
  {
    ordinal: 13,
    name: "1 Chronicles",
    short: "1 Chr",
    chapters: 29,
    aliases: ["1chron", "1chr", "1ch"],
  },
  {
    ordinal: 14,
    name: "2 Chronicles",
    short: "2 Chr",
    chapters: 36,
    aliases: ["2chron", "2chr", "2ch"],
  },
  { ordinal: 15, name: "Ezra", short: "Ezra", chapters: 10, aliases: ["ezr"] },
  {
    ordinal: 16,
    name: "Nehemiah",
    short: "Neh",
    chapters: 13,
    aliases: ["neh", "ne"],
  },
  {
    ordinal: 17,
    name: "Esther",
    short: "Esth",
    chapters: 10,
    aliases: ["esth", "est"],
  },
  { ordinal: 18, name: "Job", short: "Job", chapters: 42, aliases: ["jb"] },
  {
    ordinal: 19,
    name: "Psalms",
    short: "Ps",
    chapters: 150,
    aliases: ["psalm", "psa", "ps", "pss"],
  },
  {
    ordinal: 20,
    name: "Proverbs",
    short: "Prov",
    chapters: 31,
    aliases: ["prov", "prv", "pr"],
  },
  {
    ordinal: 21,
    name: "Ecclesiastes",
    short: "Eccl",
    chapters: 12,
    aliases: ["eccles", "eccl", "ecc", "qoh"],
  },
  {
    ordinal: 22,
    name: "Song of Solomon",
    short: "Song",
    chapters: 8,
    aliases: ["songofsongs", "song", "sos", "canticles", "cant"],
  },
  {
    ordinal: 23,
    name: "Isaiah",
    short: "Isa",
    chapters: 66,
    aliases: ["isa", "is"],
  },
  {
    ordinal: 24,
    name: "Jeremiah",
    short: "Jer",
    chapters: 52,
    aliases: ["jer", "je"],
  },
  {
    ordinal: 25,
    name: "Lamentations",
    short: "Lam",
    chapters: 5,
    aliases: ["lam", "la"],
  },
  {
    ordinal: 26,
    name: "Ezekiel",
    short: "Ezek",
    chapters: 48,
    aliases: ["ezek", "eze", "ezk"],
  },
  {
    ordinal: 27,
    name: "Daniel",
    short: "Dan",
    chapters: 12,
    aliases: ["dan", "dn"],
  },
  {
    ordinal: 28,
    name: "Hosea",
    short: "Hos",
    chapters: 14,
    aliases: ["hos", "ho"],
  },
  { ordinal: 29, name: "Joel", short: "Joel", chapters: 3, aliases: ["jl"] },
  { ordinal: 30, name: "Amos", short: "Amos", chapters: 9, aliases: ["am"] },
  {
    ordinal: 31,
    name: "Obadiah",
    short: "Obad",
    chapters: 1,
    aliases: ["obad", "ob"],
  },
  {
    ordinal: 32,
    name: "Jonah",
    short: "Jonah",
    chapters: 4,
    aliases: ["jon", "jnh"],
  },
  {
    ordinal: 33,
    name: "Micah",
    short: "Mic",
    chapters: 7,
    aliases: ["mic", "mc"],
  },
  {
    ordinal: 34,
    name: "Nahum",
    short: "Nah",
    chapters: 3,
    aliases: ["nah", "na"],
  },
  {
    ordinal: 35,
    name: "Habakkuk",
    short: "Hab",
    chapters: 3,
    aliases: ["hab", "hb"],
  },
  {
    ordinal: 36,
    name: "Zephaniah",
    short: "Zeph",
    chapters: 3,
    aliases: ["zeph", "zep", "zp"],
  },
  {
    ordinal: 37,
    name: "Haggai",
    short: "Hag",
    chapters: 2,
    aliases: ["hag", "hg"],
  },
  {
    ordinal: 38,
    name: "Zechariah",
    short: "Zech",
    chapters: 14,
    aliases: ["zech", "zec", "zc"],
  },
  {
    ordinal: 39,
    name: "Malachi",
    short: "Mal",
    chapters: 4,
    aliases: ["mal", "ml"],
  },
  {
    ordinal: 40,
    name: "Matthew",
    short: "Matt",
    chapters: 28,
    aliases: ["matt", "mat", "mt"],
  },
  {
    ordinal: 41,
    name: "Mark",
    short: "Mark",
    chapters: 16,
    aliases: ["mrk", "mk", "mr"],
  },
  {
    ordinal: 42,
    name: "Luke",
    short: "Luke",
    chapters: 24,
    aliases: ["luk", "lk"],
  },
  {
    ordinal: 43,
    name: "John",
    short: "John",
    chapters: 21,
    aliases: ["john", "jn", "jhn"],
  },
  {
    ordinal: 44,
    name: "Acts",
    short: "Acts",
    chapters: 28,
    aliases: ["act", "ac"],
  },
  {
    ordinal: 45,
    name: "Romans",
    short: "Rom",
    chapters: 16,
    aliases: ["rom", "ro", "rm"],
  },
  {
    ordinal: 46,
    name: "1 Corinthians",
    short: "1 Cor",
    chapters: 16,
    aliases: ["1cor", "1co"],
  },
  {
    ordinal: 47,
    name: "2 Corinthians",
    short: "2 Cor",
    chapters: 13,
    aliases: ["2cor", "2co"],
  },
  {
    ordinal: 48,
    name: "Galatians",
    short: "Gal",
    chapters: 6,
    aliases: ["gal", "ga"],
  },
  {
    ordinal: 49,
    name: "Ephesians",
    short: "Eph",
    chapters: 6,
    aliases: ["eph", "ephes"],
  },
  {
    ordinal: 50,
    name: "Philippians",
    short: "Phil",
    chapters: 4,
    aliases: ["phil", "php", "pp"],
  },
  {
    ordinal: 51,
    name: "Colossians",
    short: "Col",
    chapters: 4,
    aliases: ["col", "co"],
  },
  {
    ordinal: 52,
    name: "1 Thessalonians",
    short: "1 Thess",
    chapters: 5,
    aliases: ["1thess", "1thes", "1th"],
  },
  {
    ordinal: 53,
    name: "2 Thessalonians",
    short: "2 Thess",
    chapters: 3,
    aliases: ["2thess", "2thes", "2th"],
  },
  {
    ordinal: 54,
    name: "1 Timothy",
    short: "1 Tim",
    chapters: 6,
    aliases: ["1tim", "1ti", "1tm"],
  },
  {
    ordinal: 55,
    name: "2 Timothy",
    short: "2 Tim",
    chapters: 4,
    aliases: ["2tim", "2ti", "2tm"],
  },
  {
    ordinal: 56,
    name: "Titus",
    short: "Titus",
    chapters: 3,
    aliases: ["tit", "ti"],
  },
  {
    ordinal: 57,
    name: "Philemon",
    short: "Phlm",
    chapters: 1,
    aliases: ["philem", "phlm", "phm"],
  },
  {
    ordinal: 58,
    name: "Hebrews",
    short: "Heb",
    chapters: 13,
    aliases: ["heb", "hbr"],
  },
  {
    ordinal: 59,
    name: "James",
    short: "Jas",
    chapters: 5,
    aliases: ["jas", "jm"],
  },
  {
    ordinal: 60,
    name: "1 Peter",
    short: "1 Pet",
    chapters: 5,
    aliases: ["1pet", "1pe", "1pt"],
  },
  {
    ordinal: 61,
    name: "2 Peter",
    short: "2 Pet",
    chapters: 3,
    aliases: ["2pet", "2pe", "2pt"],
  },
  {
    ordinal: 62,
    name: "1 John",
    short: "1 John",
    chapters: 5,
    aliases: ["1john", "1jn", "1jhn", "1jo"],
  },
  {
    ordinal: 63,
    name: "2 John",
    short: "2 John",
    chapters: 1,
    aliases: ["2john", "2jn", "2jhn", "2jo"],
  },
  {
    ordinal: 64,
    name: "3 John",
    short: "3 John",
    chapters: 1,
    aliases: ["3john", "3jn", "3jhn", "3jo"],
  },
  {
    ordinal: 65,
    name: "Jude",
    short: "Jude",
    chapters: 1,
    aliases: ["jud", "jd"],
  },
  {
    ordinal: 66,
    name: "Revelation",
    short: "Rev",
    chapters: 22,
    aliases: ["rev", "rv", "apocalypse", "apoc"],
  },
];

/** Books 40–66, sorted alphabetically by name (for grouped pickers). */
export const NEW_TESTAMENT_BOOKS: readonly BibleBook[] = BOOKS.filter(
  (b) => b.ordinal >= 40,
)
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name));

/** Books 1–39, sorted alphabetically by name (for grouped pickers). */
export const OLD_TESTAMENT_BOOKS: readonly BibleBook[] = BOOKS.filter(
  (b) => b.ordinal <= 39,
)
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * The seven literary-genre slugs the app organizes study templates around (they
 * match the genres seeded in the admin genre library).
 */
export type GenreSlug =
  | "law"
  | "narrative"
  | "wisdom"
  | "prophecy"
  | "apocalyptic"
  | "gospel"
  | "epistle";

/**
 * Each canonical book's FIXED genre, keyed by ordinal. The 66 books each belong
 * to one genre; this association is fixed (not user-chosen). A few books span
 * categories — this follows a common Protestant classification: the Pentateuch
 * (Genesis–Deuteronomy) is `law`, Jonah is `narrative` (a narrative about a
 * prophet), Lamentations is `prophecy`, and Daniel + Revelation are
 * `apocalyptic`.
 */
const GENRE_BY_ORDINAL: Readonly<Record<number, GenreSlug>> = {
  // Law / Torah (1–5)
  1: "law",
  2: "law",
  3: "law",
  4: "law",
  5: "law",
  // Narrative / History — OT (6–17)
  6: "narrative",
  7: "narrative",
  8: "narrative",
  9: "narrative",
  10: "narrative",
  11: "narrative",
  12: "narrative",
  13: "narrative",
  14: "narrative",
  15: "narrative",
  16: "narrative",
  17: "narrative",
  // Wisdom / Poetry (18–22)
  18: "wisdom",
  19: "wisdom",
  20: "wisdom",
  21: "wisdom",
  22: "wisdom",
  // Major prophets (23–26; Lamentations is 25)
  23: "prophecy",
  24: "prophecy",
  25: "prophecy",
  26: "prophecy",
  // Daniel — apocalyptic (27)
  27: "apocalyptic",
  // Minor prophets (28–39), except Jonah (32) which is narrative
  28: "prophecy",
  29: "prophecy",
  30: "prophecy",
  31: "prophecy",
  32: "narrative",
  33: "prophecy",
  34: "prophecy",
  35: "prophecy",
  36: "prophecy",
  37: "prophecy",
  38: "prophecy",
  39: "prophecy",
  // Gospels (40–43)
  40: "gospel",
  41: "gospel",
  42: "gospel",
  43: "gospel",
  // Acts — narrative (44)
  44: "narrative",
  // Epistles (45–65)
  45: "epistle",
  46: "epistle",
  47: "epistle",
  48: "epistle",
  49: "epistle",
  50: "epistle",
  51: "epistle",
  52: "epistle",
  53: "epistle",
  54: "epistle",
  55: "epistle",
  56: "epistle",
  57: "epistle",
  58: "epistle",
  59: "epistle",
  60: "epistle",
  61: "epistle",
  62: "epistle",
  63: "epistle",
  64: "epistle",
  65: "epistle",
  // Revelation — apocalyptic (66)
  66: "apocalyptic",
};

/** The fixed genre slug for a book ordinal (1–66), or null if out of range. */
export function genreSlugForBook(ordinal: number): GenreSlug | null {
  return GENRE_BY_ORDINAL[ordinal] ?? null;
}

/** Normalize a book token for matching: lowercase, strip all non-alphanumerics. */
export function normalizeBookToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BOOK_BY_TOKEN: ReadonlyMap<string, BibleBook> = (() => {
  const map = new Map<string, BibleBook>();
  for (const book of BOOKS) {
    map.set(normalizeBookToken(book.name), book);
    for (const alias of book.aliases) {
      map.set(normalizeBookToken(alias), book);
    }
  }
  return map;
})();

/** Look up a book by any of its names/aliases (whitespace/punctuation-insensitive). */
export function findBook(token: string): BibleBook | undefined {
  return BOOK_BY_TOKEN.get(normalizeBookToken(token));
}
