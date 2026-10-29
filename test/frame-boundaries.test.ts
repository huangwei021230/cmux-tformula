import { describe, expect, it } from "vitest";
import { TerminalFrameBoundaries } from "../src/frame-boundaries.js";
import { TerminalControlGate } from "../src/terminal-output.js";
const begin = "\x1b[?2026h", end = "\x1b[?2026l";
describe("terminal frame release", () => {
  it("holds only frame-ending controls, including frames split between PTY callbacks", () => {
    const gate = new TerminalFrameBoundaries();
    expect(gate.push(begin + "partial")).toEqual([{ data: begin + "partial", inFrame: true }]);
    expect(gate.push("rest" + end + "tail")).toEqual([
      { data: "rest", inFrame: true, end }, { data: "tail", inFrame: false }
    ]);
  });
  it("leaves lookalikes inside terminal control strings intact", () => {
    const data = "\x1b]0;title [?2026h [?2026l\x07"
      + "\x1b_Ppayload [?2026l\x1b\\";
    expect(new TerminalFrameBoundaries().push(data)).toEqual([{ data, inFrame: false }]);
  });
  it("preserves every byte through arbitrary control fragmentation and multiple frames", () => {
    const data = begin + "frame1" + end + "\u009b?2026hframe2\u009b?2026l";
    const controls = new TerminalControlGate();
    const frames = new TerminalFrameBoundaries();
    const parts = [...data].flatMap((c) => frames.push(controls.push(c)));
    expect(parts.map((p) => p.data + (p.end ?? "")).join("")).toBe(data);
    expect(parts.filter((p) => p.end)).toHaveLength(2);
  });
});
