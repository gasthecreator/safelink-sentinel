// Static scan for the translation system: which phrases the code asks for (t("...") / tp("...", "...")), and which
// visible English text is still not wrapped. Heuristic by design (it reads source text), strict where it can be.

const fs = require("fs");
const path = require("path");

const STR = String.raw`"((?:[^"\\\n]|\\.)*)"`;

function unescapeJs(s) {
  return s.replace(/\\(["'\\nt])/g, (m, c) => ({ n: "\n", t: "\t" }[c] || c));
}

/** The phrases asked for in one file: [{ key, plural }] */
function phrasesIn(src) {
  const found = [];
  const t = new RegExp(String.raw`(?<![A-Za-z0-9_.])t\(\s*${STR}`, "g");
  let m;
  while ((m = t.exec(src))) found.push({ key: unescapeJs(m[1]), plural: false });
  const marked = new RegExp(String.raw`(?<![A-Za-z0-9_.])N_\(\s*${STR}`, "g");
  while ((m = marked.exec(src))) found.push({ key: unescapeJs(m[1]), plural: false });
  const tp = new RegExp(String.raw`(?<![A-Za-z0-9_.])tp\(\s*${STR}\s*,\s*${STR}`, "g");
  while ((m = tp.exec(src))) found.push({ key: unescapeJs(m[1]), plural: unescapeJs(m[2]) });
  return found;
}

const SOURCE_DIRS = ["screens", "components", "services", "constants", "App.js"];

function sourceFiles(root) {
  const out = [];
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) fs.readdirSync(p).forEach((f) => (f === "locales" || f === "i18n" || f === "node_modules" ? null : walk(path.join(p, f))));
    else if (p.endsWith(".js")) out.push(p);
  };
  SOURCE_DIRS.forEach((d) => walk(path.join(root, d)));
  return out;
}

function allPhrases(root) {
  const map = new Map(); // key -> { plural, files }
  for (const file of sourceFiles(root)) {
    for (const { key, plural } of phrasesIn(fs.readFileSync(file, "utf8"))) {
      const entry = map.get(key) || { plural: false, files: new Set() };
      if (plural) entry.plural = plural;
      entry.files.add(path.relative(root, file));
      map.set(key, entry);
    }
  }
  return map;
}

const hasWords = (s) => /[A-Za-z]{3,}/.test(s.replace(/\{[^{}]*\}/g, " "));

/** Visible English text in JSX that is not going through t(): text nodes and a few text attributes. */
function unwrappedIn(file) {
  const src = fs.readFileSync(file, "utf8");
  const problems = [];
  const line = (i) => src.slice(0, i).split("\n").length;
  // text between tags: >some words<  (not containing { } or tags), possibly over several lines
  const node = />\s*([^<>{}]*[A-Za-z]{3,}[^<>{}]*?)\s*</g;
  let m;
  while ((m = node.exec(src))) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (!hasWords(text) || /^[=>-]$/.test(text) || /=>/.test(text) || /^\w+\s*[=:(]/.test(text)) continue;
    // skip code: arrow functions, generics, comparisons that merely look like text between < and >
    if (/[;=]|=>|\breturn\b|\bconst\b|\bfunction\b|\|\||&&|\s\+\s|^\(\w+$|^\)\s*:/.test(text)) continue;
    problems.push({ file, line: line(m.index), kind: "text", text });
  }
  // words mixed in with {values}: "{count} connected", "{n} min ago" ... (text after a } or before a {, inside a tag)
  const mixed = />\s*(?:\{[^{}]*\}\s*)+([^<>{}]*[A-Za-z]{3,}[^<>{}]*?)\s*</g;
  while ((m = mixed.exec(src))) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (!hasWords(text) || text === "dBm" || /[;=]|=>|\?|:\s*\(|\|\||&&/.test(text)) continue;
    problems.push({ file, line: line(m.index), kind: "mixed", text });
  }
  const mixedBefore = />\s*([^<>{}]*[A-Za-z]{3,}[^<>{}]*?)\s*(?:\{[^{}]*\}\s*)+</g;
  while ((m = mixedBefore.exec(src))) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (!hasWords(text) || /[;=]|=>|\?|:\s*\(|\|\||&&|^[()]/.test(text)) continue;
    problems.push({ file, line: line(m.index), kind: "mixed", text });
  }
  const attr = /\b(placeholder|accessibilityLabel|accessibilityHint)="([^"]*[A-Za-z]{3,}[^"]*)"/g;
  while ((m = attr.exec(src))) problems.push({ file, line: line(m.index), kind: attr.source ? m[1] : "attr", text: m[2] });
  const alert = /Alert\.alert\(\s*"([^"]*[A-Za-z]{3,}[^"]*)"/g;
  while ((m = alert.exec(src))) problems.push({ file, line: line(m.index), kind: "alert", text: m[1] });
  return problems;
}

function unwrapped(root) {
  return sourceFiles(root)
    .filter((f) => /screens|components/.test(f))
    .flatMap(unwrappedIn);
}

module.exports = { phrasesIn, allPhrases, unwrapped, unwrappedIn, sourceFiles };

if (require.main === module) {
  const root = path.join(__dirname, "..", "..");
  const list = unwrapped(root);
  for (const p of list) console.log(`${path.relative(root, p.file)}:${p.line}  ${p.kind}: ${p.text.slice(0, 90)}`);
  console.log(`${list.length} unwrapped`);
  console.log(`${allPhrases(root).size} phrases asked for`);
}
