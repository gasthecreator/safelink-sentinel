// A static accessibility scan of the app's screens and components (JSX text, no rendering).
// It finds the things a screen reader user would hit: buttons with no role, buttons with no words,
// text boxes and switches with no label. It is deliberately simple and strict.

const fs = require("fs");
const path = require("path");

const TOUCHABLE = /<(TouchableOpacity|Pressable|TouchableHighlight|TouchableWithoutFeedback)\b/g;

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

// the opening tag, from "<Name" to its closing ">" (ignoring ">" inside {...})
function openingTag(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && src[i - 1] !== "=") return { text: src.slice(start, i + 1), end: i + 1 };
  }
  return { text: src.slice(start), end: src.length };
}

// everything between an opening tag and its matching closing tag
function body(src, name, from) {
  const closeTag = `</${name}>`;
  let depth = 1;
  const open = new RegExp(`<${name}\\b`, "g");
  let i = from;
  while (i < src.length && depth > 0) {
    const nextClose = src.indexOf(closeTag, i);
    open.lastIndex = i;
    const m = open.exec(src);
    if (m && (nextClose < 0 || m.index < nextClose)) {
      depth++;
      i = m.index + 1;
    } else if (nextClose >= 0) {
      depth--;
      i = nextClose + closeTag.length;
      if (depth === 0) return src.slice(from, nextClose);
    } else break;
  }
  return src.slice(from);
}

// Will a screen reader find words in these children? Literal text with letters counts, and so does a
// {value} shown inside <Text> (it is words at run time). A button that is only a symbol ("+", an arrow)
// does not, and needs an accessibilityLabel.
function hasWords(children) {
  const texts = [...children.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((m) => m[1]);
  if (texts.length === 0) return /[A-Za-z]{2,}/.test(children.replace(/\{[^{}]*\}/g, " ").replace(/<[^>]*>/g, " "));
  return texts.some((t) => /[A-Za-z]{2,}/.test(t.replace(/\{[^{}]*\}/g, " ")) || /\{[^{}]+\}/.test(t));
}

function scanFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const problems = [];
  let m;
  TOUCHABLE.lastIndex = 0;
  while ((m = TOUCHABLE.exec(src))) {
    const { text, end } = openingTag(src, m.index);
    const line = lineOf(src, m.index);
    if (!/accessibilityRole=/.test(text)) problems.push({ file, line, kind: "button-without-role", tag: m[1] });
    if (m[1] !== "TouchableWithoutFeedback" && !/accessibilityLabel=/.test(text)) {
      const children = body(src, m[1], end);
      if (!hasWords(children)) problems.push({ file, line, kind: "button-without-words", tag: m[1] });
    }
  }
  for (const [name, kind] of [["TextInput", "input-without-label"], ["Switch", "switch-without-label"]]) {
    const re = new RegExp(`<${name}\\b`, "g");
    while ((m = re.exec(src))) {
      const { text } = openingTag(src, m.index);
      if (!/accessibilityLabel=/.test(text)) problems.push({ file, line: lineOf(src, m.index), kind, tag: name });
    }
  }
  const imgs = /<Image\b/g;
  while ((m = imgs.exec(src))) {
    const { text } = openingTag(src, m.index);
    if (!/accessibilityLabel=|accessible=\{false\}|accessibilityRole="none"/.test(text)) problems.push({ file, line: lineOf(src, m.index), kind: "image-without-label", tag: "Image" });
  }
  if (/allowFontScaling=\{false\}/.test(src)) problems.push({ file, line: lineOf(src, src.indexOf("allowFontScaling={false}")), kind: "font-scaling-off", tag: "Text" });
  return problems;
}

function scanApp(root) {
  const out = [];
  for (const dir of ["screens", "components"]) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith(".js")) out.push(...scanFile(path.join(d, f)));
  }
  return out;
}

module.exports = { scanFile, scanApp };

if (require.main === module) {
  const problems = scanApp(path.join(__dirname, "..", ".."));
  for (const p of problems) console.log(`${path.relative(process.cwd(), p.file)}:${p.line}  ${p.kind} (${p.tag})`);
  console.log(`${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
}
