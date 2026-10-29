import { describe, expect, it } from "vitest";
import { detectFormulas } from "../src/detect.js";
import { detectScreenFormulaRegions } from "../src/screen-text.js";

const detect = (lines: string[]) => detectFormulas(lines, { strict: true }).map((f) => f.latex);
describe("strict terminal math detection", () => {
  it("leaves literal backticks, identifiers, parentheses and code examples alone", () => {
    expect(detect(["``", "()", "(x)", "(x=1)", "函数 foo() 和 (说明)", "a_b", "`$x^2$`", "``\\(y^2\\)``",
      "```latex", "$$z^2$$", "```", "真实公式 $p^2$"]))
      .toEqual(["p^2"]);
  });
  it("protects streamed open code spans, unequal runs and hard-wrapped code", () => {
    expect(detect(["`$x^2$"])).toEqual([]);
    expect(detect(["`` $x^2$ ` $y^2$"])).toEqual([]);
    expect(detect(["literal ``", "", "$x^2$ and `` literal"])).toEqual(["x^2"]);
    expect(detect(["代码 ``$x^2$", "% not a TeX comment here`` 后面 $z^2$"]))
      .toEqual(["z^2"]);
  });
  it("still accepts explicit inline/display math and complete environments", () => {
    expect(detect(["$x^2$", "\\(y^2\\)", "\\[", "\\frac{1}{3}", "\\]",
      "$$z^2$$", "\\begin{equation}a=b\\end{equation}"]))
      .toEqual(expect.arrayContaining(["x^2", "y^2", "\\frac{1}{3}", "z^2", "\\begin{equation}a=b\\end{equation}"]));
  });
  it("never packs prose or backticks following a formula into its image", () => {
    const text = "公式 $x^2$，后面是 `` 和 `a_b`。";
    const snapshot = detectScreenFormulaRegions([{ row: 0, text, isWrapped: false }], 100, false, true);
    expect(snapshot.formulas).toHaveLength(1);
    expect(snapshot.formulas[0]!.formula.latex).toBe("x^2");
    expect(snapshot.formulas[0]!.composite).toBe(false);
    expect(snapshot.formulas[0]!.source.endCol).toBeLessThan(12);
  });
  it("protects a code span split by terminal soft wrapping", () => {
    const snapshot = detectScreenFormulaRegions([
      { row: 0, text: "代码 `", isWrapped: false },
      { row: 1, text: "$x^2$` 后面 $z^2$", isWrapped: true }
    ], 40, false, true);
    expect(snapshot.formulas.map((f) => f.formula.latex)).toEqual(["z^2"]);
  });
});
