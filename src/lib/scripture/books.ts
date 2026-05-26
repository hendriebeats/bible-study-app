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
  readonly chapters: number;
  readonly aliases: readonly string[];
}

export const BOOKS: readonly BibleBook[] = [
  { ordinal: 1, name: "Genesis", chapters: 50, aliases: ["gen", "ge", "gn"] },
  { ordinal: 2, name: "Exodus", chapters: 40, aliases: ["exod", "exo", "ex"] },
  { ordinal: 3, name: "Leviticus", chapters: 27, aliases: ["lev", "lv"] },
  { ordinal: 4, name: "Numbers", chapters: 36, aliases: ["num", "nm", "nu"] },
  { ordinal: 5, name: "Deuteronomy", chapters: 34, aliases: ["deut", "dt"] },
  { ordinal: 6, name: "Joshua", chapters: 24, aliases: ["josh", "jos"] },
  { ordinal: 7, name: "Judges", chapters: 21, aliases: ["judg", "jdg", "jgs"] },
  { ordinal: 8, name: "Ruth", chapters: 4, aliases: ["ru", "rth"] },
  {
    ordinal: 9,
    name: "1 Samuel",
    chapters: 31,
    aliases: ["1sam", "1sa", "1sm", "1s"],
  },
  {
    ordinal: 10,
    name: "2 Samuel",
    chapters: 24,
    aliases: ["2sam", "2sa", "2sm", "2s"],
  },
  {
    ordinal: 11,
    name: "1 Kings",
    chapters: 22,
    aliases: ["1kings", "1kgs", "1ki", "1kg"],
  },
  {
    ordinal: 12,
    name: "2 Kings",
    chapters: 25,
    aliases: ["2kings", "2kgs", "2ki", "2kg"],
  },
  {
    ordinal: 13,
    name: "1 Chronicles",
    chapters: 29,
    aliases: ["1chron", "1chr", "1ch"],
  },
  {
    ordinal: 14,
    name: "2 Chronicles",
    chapters: 36,
    aliases: ["2chron", "2chr", "2ch"],
  },
  { ordinal: 15, name: "Ezra", chapters: 10, aliases: ["ezr"] },
  { ordinal: 16, name: "Nehemiah", chapters: 13, aliases: ["neh", "ne"] },
  { ordinal: 17, name: "Esther", chapters: 10, aliases: ["esth", "est"] },
  { ordinal: 18, name: "Job", chapters: 42, aliases: ["jb"] },
  {
    ordinal: 19,
    name: "Psalms",
    chapters: 150,
    aliases: ["psalm", "psa", "ps", "pss"],
  },
  {
    ordinal: 20,
    name: "Proverbs",
    chapters: 31,
    aliases: ["prov", "prv", "pr"],
  },
  {
    ordinal: 21,
    name: "Ecclesiastes",
    chapters: 12,
    aliases: ["eccles", "eccl", "ecc", "qoh"],
  },
  {
    ordinal: 22,
    name: "Song of Solomon",
    chapters: 8,
    aliases: ["songofsongs", "song", "sos", "canticles", "cant"],
  },
  { ordinal: 23, name: "Isaiah", chapters: 66, aliases: ["isa", "is"] },
  { ordinal: 24, name: "Jeremiah", chapters: 52, aliases: ["jer", "je"] },
  { ordinal: 25, name: "Lamentations", chapters: 5, aliases: ["lam", "la"] },
  {
    ordinal: 26,
    name: "Ezekiel",
    chapters: 48,
    aliases: ["ezek", "eze", "ezk"],
  },
  { ordinal: 27, name: "Daniel", chapters: 12, aliases: ["dan", "dn"] },
  { ordinal: 28, name: "Hosea", chapters: 14, aliases: ["hos", "ho"] },
  { ordinal: 29, name: "Joel", chapters: 3, aliases: ["jl"] },
  { ordinal: 30, name: "Amos", chapters: 9, aliases: ["am"] },
  { ordinal: 31, name: "Obadiah", chapters: 1, aliases: ["obad", "ob"] },
  { ordinal: 32, name: "Jonah", chapters: 4, aliases: ["jon", "jnh"] },
  { ordinal: 33, name: "Micah", chapters: 7, aliases: ["mic", "mc"] },
  { ordinal: 34, name: "Nahum", chapters: 3, aliases: ["nah", "na"] },
  { ordinal: 35, name: "Habakkuk", chapters: 3, aliases: ["hab", "hb"] },
  {
    ordinal: 36,
    name: "Zephaniah",
    chapters: 3,
    aliases: ["zeph", "zep", "zp"],
  },
  { ordinal: 37, name: "Haggai", chapters: 2, aliases: ["hag", "hg"] },
  {
    ordinal: 38,
    name: "Zechariah",
    chapters: 14,
    aliases: ["zech", "zec", "zc"],
  },
  { ordinal: 39, name: "Malachi", chapters: 4, aliases: ["mal", "ml"] },
  {
    ordinal: 40,
    name: "Matthew",
    chapters: 28,
    aliases: ["matt", "mat", "mt"],
  },
  { ordinal: 41, name: "Mark", chapters: 16, aliases: ["mrk", "mk", "mr"] },
  { ordinal: 42, name: "Luke", chapters: 24, aliases: ["luk", "lk"] },
  { ordinal: 43, name: "John", chapters: 21, aliases: ["john", "jn", "jhn"] },
  { ordinal: 44, name: "Acts", chapters: 28, aliases: ["act", "ac"] },
  { ordinal: 45, name: "Romans", chapters: 16, aliases: ["rom", "ro", "rm"] },
  {
    ordinal: 46,
    name: "1 Corinthians",
    chapters: 16,
    aliases: ["1cor", "1co"],
  },
  {
    ordinal: 47,
    name: "2 Corinthians",
    chapters: 13,
    aliases: ["2cor", "2co"],
  },
  { ordinal: 48, name: "Galatians", chapters: 6, aliases: ["gal", "ga"] },
  { ordinal: 49, name: "Ephesians", chapters: 6, aliases: ["eph", "ephes"] },
  {
    ordinal: 50,
    name: "Philippians",
    chapters: 4,
    aliases: ["phil", "php", "pp"],
  },
  { ordinal: 51, name: "Colossians", chapters: 4, aliases: ["col", "co"] },
  {
    ordinal: 52,
    name: "1 Thessalonians",
    chapters: 5,
    aliases: ["1thess", "1thes", "1th"],
  },
  {
    ordinal: 53,
    name: "2 Thessalonians",
    chapters: 3,
    aliases: ["2thess", "2thes", "2th"],
  },
  {
    ordinal: 54,
    name: "1 Timothy",
    chapters: 6,
    aliases: ["1tim", "1ti", "1tm"],
  },
  {
    ordinal: 55,
    name: "2 Timothy",
    chapters: 4,
    aliases: ["2tim", "2ti", "2tm"],
  },
  { ordinal: 56, name: "Titus", chapters: 3, aliases: ["tit", "ti"] },
  {
    ordinal: 57,
    name: "Philemon",
    chapters: 1,
    aliases: ["philem", "phlm", "phm"],
  },
  { ordinal: 58, name: "Hebrews", chapters: 13, aliases: ["heb", "hbr"] },
  { ordinal: 59, name: "James", chapters: 5, aliases: ["jas", "jm"] },
  {
    ordinal: 60,
    name: "1 Peter",
    chapters: 5,
    aliases: ["1pet", "1pe", "1pt"],
  },
  {
    ordinal: 61,
    name: "2 Peter",
    chapters: 3,
    aliases: ["2pet", "2pe", "2pt"],
  },
  {
    ordinal: 62,
    name: "1 John",
    chapters: 5,
    aliases: ["1john", "1jn", "1jhn", "1jo"],
  },
  {
    ordinal: 63,
    name: "2 John",
    chapters: 1,
    aliases: ["2john", "2jn", "2jhn", "2jo"],
  },
  {
    ordinal: 64,
    name: "3 John",
    chapters: 1,
    aliases: ["3john", "3jn", "3jhn", "3jo"],
  },
  { ordinal: 65, name: "Jude", chapters: 1, aliases: ["jud", "jd"] },
  {
    ordinal: 66,
    name: "Revelation",
    chapters: 22,
    aliases: ["rev", "rv", "apocalypse", "apoc"],
  },
];

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
