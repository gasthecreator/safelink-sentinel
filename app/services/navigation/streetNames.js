// app/services/navigation/streetNames.js
// OpenStreetMap spells the same street several ways ("Martin Luther King Jr Avenue" and "... Junior Avenue",
// "PIne Avenue" for a typo). The directions would read that as two roads and announce a turn that is not
// one. This brings the common cases to one spelling, conservatively: it only ever changes words that are
// unmistakable, and never changes meaning (it does not guess at names it does not know).

const ABBREVIATIONS = {
  st: "Street", ave: "Avenue", av: "Avenue", rd: "Road", dr: "Drive", ln: "Lane", blvd: "Boulevard",
  ct: "Court", cir: "Circle", hwy: "Highway", pkwy: "Parkway", pl: "Place", trl: "Trail", tr: "Trail",
  jr: "Junior", sr: "Senior", mlk: "Martin Luther King",
};

// Directions at the START of a name are spelled out too ("N Main St" -> "North Main Street").
const DIRECTIONS = { n: "North", s: "South", e: "East", w: "West", ne: "Northeast", nw: "Northwest", se: "Southeast", sw: "Southwest" };

const SMALL = new Set(["of", "the", "and", "de", "la", "del", "van", "von", "to"]);
// Acronyms that stay upper-case (route and state names)
const KEEP_UPPER = new Set(["US", "LA", "TX", "AR", "MS", "FM", "I", "II", "III", "IV", "NE", "NW", "SE", "SW"]);

const stripDot = (w) => w.replace(/\.+$/g, "");

/**
 * One word: "PIne" -> "Pine", "AVE." -> "Avenue". Anything it is not sure about is returned exactly as typed
 * (including a trailing dot: "No." stays "No.").
 */
function fixWord(word, index, words) {
  const bare = stripDot(word);
  const lower = bare.toLowerCase();
  if (/^\d/.test(bare)) return word; // numbers and 9th / 2nd / 63rd
  if (KEEP_UPPER.has(bare)) return word;
  const last = index === words.length - 1;
  const first = index === 0;
  if (DIRECTIONS[lower] && first && words.length > 1 && bare.length <= 2) return DIRECTIONS[lower];
  if (ABBREVIATIONS[lower] && bare.length <= 4) {
    // "St" is only "Street" after a name, not at the start ("St Mary" is Saint Mary: leave it)
    if (lower === "st" && first) return word;
    if (lower === "tr" || lower === "pl" || lower === "av") return last ? ABBREVIATIONS[lower] : word;
    return ABBREVIATIONS[lower];
  }
  // A capital in the middle is a typo ("PIne": two capitals at the start, then lower case), or shouting
  // ("MAIN"). A brand written with a capital inside ("QuickCare", "SouthStar", "McDonald") is left alone.
  const typo = /^[A-Z]{2}[a-z]+$/.test(bare) && !/^(Mc|Mac)/.test(bare);
  const shouting = bare.length > 3 && bare === bare.toUpperCase() && /[A-Z]/.test(bare);
  if (typo || shouting) {
    const small = SMALL.has(lower) && !first;
    const fixed = small ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    return word.endsWith(".") ? `${fixed}.` : fixed;
  }
  return word;
}

/** The spelling used to compare and announce a street name. */
export function normalizeStreetName(name) {
  if (typeof name !== "string") return "";
  const words = name.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.map((w, i) => fixWord(w, i, words)).join(" ");
}

/** The same name with everything that is not a letter or digit removed and lower-cased: for "is it the same road?". */
export function streetKey(name) {
  return normalizeStreetName(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
