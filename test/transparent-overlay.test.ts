import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import type { Terminal as XtermTerminal } from "@xterm/headless";
import sharp from "sharp";
import { FormulaScreen } from "../src/screen.js";
import { MathRenderer } from "../src/math-renderer.js";

const { Terminal } = createRequire(import.meta.url)("@xterm/headless") as { Terminal: typeof XtermTerminal };
const capabilities = { kittyGraphics: true, foreground: "#ffffff", background: "#000000",
  cell: { width: 9, height: 18, source: "cell-query" as const } };
const formula = "Before\r\n\\[\r\n\\frac{1}{3}\r\n\\]\r\nAfter\r\n";

async function harness(initialRow = 1, renderer = new MathRenderer()) {
  const terminal = new Terminal({ cols: 80, rows: 12, allowProposedApi: true, reflowCursorLine: true });
  const uploads: Uint8Array[] = [];
  const packets: string[] = [];
  const write = (s: string) => new Promise<void>((resolve) => terminal.write(s, resolve));
  if (initialRow > 1) await write("Last login\r\n");
  const screen = new FormulaScreen({ cols: 80, rows: 12,
    capabilities: { ...capabilities, initialCursor: { row: initialRow, column: 1 } }, scale: 1,
    transparentBackground: true, strictDetection: true, stabilityMs: 0, renderer,
    transmitImage: (png, id) => { uploads.push(png); return `\x1b_Ga=t,i=${id};\x1b\\`; },
    writeOuter: (s) => { packets.push(String(s)); terminal.write(String(s)); },
    writeGraphics: async (create) => {
      const s = create(); if (s === undefined) return false;
      packets.push(String(s)); await write(String(s)); return true;
    }
  });
  return { terminal, screen, uploads, packets,
    async output(s: string, scan = true) {
      await write(s); await screen.write(s); if (scan) await screen.flushScan();
    },
    async drain() { await write(""); },
    close() { screen.dispose(); terminal.dispose(); }
  };
}

describe("transparent terminal formula overlays", () => {
  it("keeps lifecycle deletes inside the proxy frame while mirroring an unframed clear", async () => {
    const h = await harness();
    try {
      await h.output("\x1b[?1049h" + formula);
      h.packets.length = 0;
      h.screen.setOutputFrameActive(true);
      await h.output("\x1b[2J\x1b[H\r\n" + formula, false);
      await h.screen.flushFrameScan(true);
      expect(h.packets.join("")).toContain("a=p");
      expect(h.packets.join("")).not.toContain("\x1b[?2026l");
      expect(h.terminal.buffer.active.getLine(3)!.getCell(0)!.isInvisible()).toBeTruthy();
    } finally { h.screen.setOutputFrameActive(false); h.close(); }
  });

  it("joins an in-flight render before releasing a redraw with cached formulas", async () => {
    const renderer = new MathRenderer();
    const original = renderer.renderPlacement.bind(renderer);
    const h = await harness(1, renderer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const rendering = new Promise<void>((resolve) => { started = resolve; });
    try {
      await h.output("\x1b[?1049h" + formula);
      vi.spyOn(renderer, "renderPlacement").mockImplementationOnce(async (...args) => {
        started(); await gate; return original(...args);
      });
      await h.output("\x1b[2J\x1b[H" + formula.replace("{1}{3}", "{17}{19}"), false);
      const background = h.screen.flushScan();
      await rendering;
      await h.output("\x1b[?2026h\x1b[2J\x1b[H\r\n" + formula, false);
      h.packets.length = 0;
      setTimeout(release, 5);
      await h.screen.flushFrameScan(false, 80);
      await h.drain();
      expect(h.terminal.buffer.active.getLine(3)!.getCell(0)!.isInvisible()).toBeTruthy();
      expect(h.packets.join("")).toContain("a=p");
      expect(h.packets.join("")).not.toContain("\x1b[?2026l");
      await background;
    } finally { release(); h.close(); }
  });

  it("releases the frame budget when cold typesetting stalls, then completes asynchronously", async () => {
    const renderer = new MathRenderer();
    const original = renderer.renderPlacement.bind(renderer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const render = vi.spyOn(renderer, "renderPlacement").mockImplementationOnce(async (...args) => {
      await gate; return original(...args);
    });
    const h = await harness(1, renderer);
    try {
      await h.output("\x1b[?2026h" + formula, false);
      await h.screen.flushFrameScan(false, 10);
      expect(render).toHaveBeenCalledOnce();
      expect(h.uploads).toHaveLength(0);
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeFalsy();
      release();
      await h.output("\x1b[?2026l");
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeTruthy();
    } finally { release(); h.close(); }
  });

  it("places cached formulas before frame release without starting cold renders", async () => {
    const renderer = new MathRenderer();
    const render = vi.spyOn(renderer, "renderPlacement");
    const h = await harness(1, renderer);
    try {
      await h.output("\x1b[?1049h" + formula);
      render.mockClear();
      h.packets.length = 0;
      // Redraw the same formula at another row inside an application frame.
      const redraw = "\x1b[?2026h\x1b[2J\x1b[H\r\n" + formula;
      await new Promise<void>((resolve) => h.terminal.write(redraw, resolve));
      await h.screen.write(redraw);
      await h.screen.flushCachedScan();
      await h.drain();
      expect(render).not.toHaveBeenCalled();
      expect(h.packets.join("")).toContain("a=p");
      expect(h.packets.join("")).not.toContain("\x1b[?2026l");
      expect(h.terminal.buffer.active.getLine(3)!.getCell(0)!.isInvisible()).toBeTruthy();

      const cold = "\x1b[2J\x1b[H" + formula.replace("{1}{3}", "{77}{91}");
      await new Promise<void>((resolve) => h.terminal.write(cold, resolve));
      await h.screen.write(cold);
      await h.screen.flushCachedScan();
      expect(render).not.toHaveBeenCalled();
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeFalsy();
      await h.output("\x1b[?2026l");
      expect(render).toHaveBeenCalled();
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeTruthy();
    } finally { h.close(); }
  });

  it("accounts for login output printed before the proxy started", async () => {
    const h = await harness(2);
    try {
      await h.output(formula);
      expect(h.terminal.buffer.active.getLine(0)!.translateToString(true)).toBe("Last login");
      expect(h.terminal.buffer.active.getLine(1)!.translateToString(true)).toBe("Before");
      expect(h.terminal.buffer.active.getLine(1)!.getCell(0)!.isInvisible()).toBeFalsy();
      expect(h.terminal.buffer.active.getLine(3)!.translateToString(true)).toBe("\\frac{1}{3}");
      expect(h.terminal.buffer.active.getLine(3)!.getCell(0)!.isInvisible()).toBeTruthy();
      expect(h.terminal.buffer.active.getLine(5)!.translateToString(true)).toBe("After");
    } finally { h.close(); }
  });
  it("keeps PNG backgrounds transparent, conceals source glyphs and preserves copy and cursor", async () => {
    const h = await harness();
    try {
      await h.output(formula);
      expect(h.uploads.length).toBeGreaterThan(0);
      const { data, info } = await sharp(h.uploads[0]!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info.channels).toBe(4);
      expect(data[3]).toBe(0);
      expect(data[(info.width * info.height - 1) * 4 + 3]).toBe(0);
      expect(h.terminal.buffer.active.getLine(1)!.translateToString(true)).toBe("\\[");
      expect(h.terminal.buffer.active.getLine(2)!.translateToString(true)).toBe("\\frac{1}{3}");
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeTruthy();
      expect(h.terminal.buffer.active.getLine(0)!.getCell(0)!.isInvisible()).toBeFalsy();
      expect(h.terminal.buffer.active.getLine(4)!.getCell(0)!.isInvisible()).toBeFalsy();
      expect(h.terminal.buffer.active.cursorX).toBe(h.screen.terminal.buffer.active.cursorX);
      expect(h.terminal.buffer.active.cursorY).toBe(h.screen.terminal.buffer.active.cursorY);
      await h.output("typed text");
      expect(h.terminal.buffer.active.getLine(5)!.translateToString(true)).toBe("typed text");
      expect(h.terminal.buffer.active.getLine(5)!.getCell(0)!.isInvisible()).toBeFalsy();
    } finally { h.close(); }
  });

  it("reconceals an unchanged formula after a TUI redraw, then restores it on graphics rejection", async () => {
    const h = await harness();
    try {
      await h.output("\x1b[?1049h\x1b[H" + formula);
      await h.output("\x1b[3;1H\\frac{1}{3}\x1b[6;1H");
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeTruthy();
      const packet = h.packets.findLast((s) => s.includes("a=p"))!;
      const imageId = Number(packet.match(/a=p,i=(\d+)/)![1]);
      expect(h.screen.invalidateTerminalImage(imageId, "test rejection", false)).toBe(true);
      await h.screen.flushScan(); await h.drain();
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeFalsy();
      expect(h.terminal.buffer.active.getLine(2)!.translateToString(true)).toBe("\\frac{1}{3}");
    } finally { h.close(); }
  });

  it("restores source on reset and never conceals replacement prose", async () => {
    const h = await harness();
    try {
      await h.output(formula);
      h.screen.resetPlacements(); await h.drain();
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeFalsy();
      await h.output("\x1b[2J\x1b[Hreplacement prose");
      expect(h.terminal.buffer.active.getLine(0)!.translateToString(true)).toBe("replacement prose");
      expect(h.terminal.buffer.active.getLine(0)!.getCell(0)!.isInvisible()).toBeFalsy();
    } finally { h.close(); }
  });

  it("preserves application cursor-save slots and pen colors", async () => {
    const h = await harness();
    try {
      await h.output("\x1b[32m\x1b[7;8H\x1b7\x1b[H" + formula);
      await h.output("\x1b8Z");
      const z = h.terminal.buffer.active.getLine(6)!.getCell(7)!;
      expect(z.getChars()).toBe("Z");
      expect(z.isInvisible()).toBeFalsy();
      expect(z.isFgPalette()).toBeTruthy();
      expect(z.getFgColor()).toBe(2);
    } finally { h.close(); }
  });

  it("keeps source characters intact through resize, scrollback and alternate-screen switches", async () => {
    const h = await harness();
    try {
      await h.output(formula);
      h.terminal.resize(40, 12); h.screen.resize(40, 12);
      await h.screen.flushScan();
      expect(h.terminal.buffer.active.getLine(2)!.translateToString(true)).toBe("\\frac{1}{3}");
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeTruthy();
      await h.output("\r\n".repeat(15));
      expect(h.terminal.buffer.active.getLine(2)!.translateToString(true)).toBe("\\frac{1}{3}");
      await h.output("\x1b[?1049h\x1b[H" + formula);
      expect(h.terminal.buffer.active.getLine(2)!.getCell(0)!.isInvisible()).toBeTruthy();
      await h.output("\x1b[?1049lplain prompt");
      const buffer = h.terminal.buffer.active;
      const line = buffer.getLine(buffer.baseY + buffer.cursorY)!;
      expect(line.translateToString(true)).toContain("plain prompt");
      expect(line.getCell(0)!.isInvisible()).toBeFalsy();
    } finally { h.close(); }
  });

  it("conceals inline TeX without changing adjacent Unicode prose or source copying", async () => {
    const h = await harness();
    try {
      const line = "中文： $\\frac{a}{b}$ 后续文字。";
      await h.output(line + "\r\n");
      expect(h.terminal.buffer.active.getLine(0)!.translateToString(true)).toBe(line);
      expect(h.terminal.buffer.active.getLine(0)!.getCell(0)!.isInvisible()).toBeFalsy();
      expect(h.packets.join("")).toContain("\x1b[8m");
    } finally { h.close(); }
  });
});
