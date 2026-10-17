const fs = require("fs");
const path = require("path");

// The home screen's footer links wrap onto several rows (more in longer languages). Vertical hit slop on rows
// that sit ~18 dp apart overlaps, so a tap on "Find help nearby" opened "Saved places" on a real (Spanish) screen.
describe("home footer links", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "screens", "MeshHomeScreen.js"), "utf8");
  const start = src.indexOf("<View style={styles.footerLinks}>");
  const block = src.slice(start, src.indexOf("</View>", start));

  test("none of them uses vertical hit slop", () => {
    expect(start).toBeGreaterThan(0);
    expect(block).not.toMatch(/hitSlop=\{HIT_SLOP\}/);
    const slop = src.match(/const LINK_SLOP = \{([^}]*)\}/)[1];
    expect(slop).toMatch(/top:\s*0/);
    expect(slop).toMatch(/bottom:\s*0/);
  });

  test("each link has its own vertical padding so rows do not touch", () => {
    expect((block.match(/styles\.footerLink\b/g) || []).length).toBe(6);
    expect(src).toMatch(/footerLink:\s*\{\s*paddingVertical:\s*(\d+)/);
    expect(Number(src.match(/footerLink:\s*\{\s*paddingVertical:\s*(\d+)/)[1])).toBeGreaterThanOrEqual(10);
  });
});
