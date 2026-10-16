// Accessibility guards: screen-reader labels on every control, readable colour pairs, no font-scaling opt-outs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { scanApp, scanFile } = require("../scripts/lib/a11yScan.js");
const { ratio } = require("../scripts/lib/contrast.js");

describe("every control tells a screen reader what it is", () => {
  test("the screens and components have no unlabelled buttons, inputs, switches or images", () => {
    const problems = scanApp(path.join(__dirname, ".."));
    expect(problems.map((p) => `${path.basename(p.file)}:${p.line} ${p.kind}`)).toEqual([]);
  });

  // the scanner itself must catch what it is for
  const scan = (jsx) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "a11y-")), "X.js");
    fs.writeFileSync(file, jsx);
    return scanFile(file).map((p) => p.kind);
  };
  test("a button with no role is found", () => {
    expect(scan(`<TouchableOpacity onPress={go}><Text>Save</Text></TouchableOpacity>`)).toEqual(["button-without-role"]);
  });
  test("a symbol-only button with no label is found; with a label it passes", () => {
    expect(scan(`<TouchableOpacity accessibilityRole="button" onPress={go}><Text>+</Text></TouchableOpacity>`)).toEqual(["button-without-words"]);
    expect(scan(`<TouchableOpacity accessibilityRole="button" accessibilityLabel="Zoom in" onPress={go}><Text>+</Text></TouchableOpacity>`)).toEqual([]);
  });
  test("a button whose words come from a value is fine", () => {
    expect(scan(`<TouchableOpacity accessibilityRole="button" onPress={go}><Text>{label}</Text></TouchableOpacity>`)).toEqual([]);
  });
  test("an unlabelled text box, switch and image are found", () => {
    expect(scan(`<TextInput value={a} onChangeText={b} placeholder="x" />`)).toEqual(["input-without-label"]);
    expect(scan(`<Switch value={a} onValueChange={b} />`)).toEqual(["switch-without-label"]);
    expect(scan(`<Image source={x} />`)).toEqual(["image-without-label"]);
    expect(scan(`<TextInput accessibilityLabel="Name" value={a} />`)).toEqual([]);
  });
  test("turning font scaling off is found", () => {
    expect(scan(`<Text allowFontScaling={false}>x</Text>`)).toEqual(["font-scaling-off"]);
  });
});

describe("text can be read: WCAG AA (4.5:1) for the colour pairs the screens use", () => {
  // [text, background, where]
  const PAIRS = [
    ["#2563EB", "#F8FAFC", "links and Back on light screens"],
    ["#2563EB", "#FFFFFF", "links on cards"],
    ["#64748B", "#F8FAFC", "secondary text on light screens"],
    ["#64748B", "#FFFFFF", "secondary text and placeholders on cards"],
    ["#475569", "#F8FAFC", "intro text on light screens"],
    ["#FFFFFF", "#047857", "green buttons"],
    ["#FFFFFF", "#15803D", "green buttons on dark screens"],
    ["#FFFFFF", "#2563EB", "blue buttons and chips"],
    ["#FFFFFF", "#DC2626", "Stop"],
    ["#92400E", "#FEF3C7", "waiting-message banner"],
    ["#B91C1C", "#F8FAFC", "errors on light screens"],
    ["#94A3B8", "#0B1220", "secondary text on dark screens"],
    ["#94A3B8", "#111C30", "secondary text on dark cards, placeholders"],
    ["#CBD5E1", "#111C30", "body text on dark cards"],
    ["#38BDF8", "#0B1220", "links on dark screens"],
    ["#FBBF24", "#0F2A4A", "warnings in the live panel"],
    ["#F87171", "#0B1220", "errors on dark screens"],
    ["#93C5FD", "#0B1220", "route detours"],
  ];
  test.each(PAIRS)("%s on %s (%s)", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  test("the colours that failed before are not used as text or button colours again", () => {
    const failing = [
      ["#3B82F6", /color:\s*"#3B82F6"/], // blue text on light: 3.5:1
      ["#10B981 button", /button:\s*\{[^}]*backgroundColor:\s*"#10B981"/], // white on it: 2.5:1
    ];
    for (const dir of ["screens", "components"]) {
      for (const f of fs.readdirSync(path.join(__dirname, "..", dir))) {
        if (f === "OnboardingScreen.js" || f === "MessageCard.js" || f === "PeerListScreen.js") continue; // dark / decorative uses
        const src = fs.readFileSync(path.join(__dirname, "..", dir, f), "utf8");
        for (const [name, re] of failing) expect([f, name, re.test(src)]).toEqual([f, name, false]);
      }
    }
  });
});
