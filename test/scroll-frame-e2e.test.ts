import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

describe("fragmented unframed PTY redraws", () => {
  it.each(["1", "tmux"])("places warm formulas before frame release with fragmentation mode %s", async (mode) => {
    const { stdout } = await promisify(execFile)(process.execPath,
      ["benchmark/scroll-frames.mjs", "src/cli.ts"], {
        cwd: process.cwd(), env: { ...process.env, TFORMULA_SCROLL_FRAGMENTED: mode },
        timeout: 15_000
      });
    const report = JSON.parse(stdout);
    expect(report.exitCode).toBe(0);
    expect(report.warmFrames).toBe(12);
    expect(report.imagesReadyBeforeFrameRelease).toBe(12);
  }, 16_000);
});
