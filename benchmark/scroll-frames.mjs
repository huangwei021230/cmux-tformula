import { spawn } from "node-pty";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(process.argv[2] ?? join(root, "dist/cli.js"));
const cache = mkdtempSync(join(tmpdir(), "tformula-scroll-"));
const env = { ...process.env, TERM: "xterm-ghostty", TERM_PROGRAM: "ghostty",
  TFORMULA_TRANSPARENT: "1", TFORMULA_STRICT: "1", TFORMULA_CACHE_DIR: cache };
delete env.TFORMULA_ACTIVE;
let transcript = "", pending = "", answered = false, frame;
const frames = [];
const pty = spawn(process.execPath, [...(cli.endsWith(".ts") ? ["--import", "tsx"] : []), cli, "--no-history", "--", process.execPath,
  join(root, "test/fixtures/scroll-agent.mjs")], { name: "xterm-ghostty", cols: 100, rows: 32, cwd: root, env });
const timeout = setTimeout(() => { pty.kill(); throw new Error("scroll benchmark timed out"); }, 15000);
pty.onData((data) => {
  transcript += data;
  if (!answered && transcript.includes("\x1b[16t")) {
    answered = true;
    pty.write("\x1b[1;1R\x1b[6;18;9t\x1b[4;576;900t\x1b]10;rgb:ffff/ffff/ffff\x1b\\\x1b]11;rgb:0000/0000/0000\x1b\\\x1b[?62;4;6;22c");
  }
  pending += data;
  const tokens = /\x1b_G[^\x1b]*\x1b\\|FRAME:(\d+)\r|\x1b\[\?2026l/gu;
  let consumed = 0;
  for (const match of pending.matchAll(tokens)) {
    const token = match[0]; consumed = match.index + token.length;
    const now = performance.now();
    if (match[1] !== undefined) {
      frame = { id: Number(match[1]), started: now, placements: 0, readyBeforeRelease: false };
      frames.push(frame);
    } else if (token.startsWith("\x1b_G")) {
      const id = token.match(/(?:^|,)i=(\d+)/u)?.[1] ?? token.match(/_Gi=(\d+)/u)?.[1];
      const placement = token.match(/(?:^|,)p=(\d+)/u)?.[1];
      if (id) pty.write(`\x1b_Gi=${id}${placement ? `,p=${placement}` : ""};OK\x1b\\`);
      if (token.includes("a=p") && frame) {
        frame.placements++;
        if (frame.placements === 4) frame.imageLatencyMs = now - frame.started;
      }
    } else if (frame && frame.releaseMs === undefined) {
      frame.releaseMs = now - frame.started;
      frame.readyBeforeRelease = frame.placements >= 4;
    }
  }
  pending = pending.slice(consumed);
});
pty.onExit(({ exitCode }) => {
  clearTimeout(timeout); rmSync(cache, { recursive: true, force: true });
  const warm = frames.filter((f) => f.id > 0);
  const latency = warm.flatMap((f) => f.imageLatencyMs === undefined ? [] : [f.imageLatencyMs]).sort((a, b) => a - b);
  console.log(JSON.stringify({ cli, exitCode, redrawMode: env.TFORMULA_SCROLL_FRAGMENTED ?? "synchronized", warmFrames: warm.length,
    imagesReadyBeforeFrameRelease: warm.filter((f) => f.readyBeforeRelease).length,
    medianImageLatencyMs: latency.length ? +latency[Math.floor(latency.length / 2)].toFixed(2) : null,
    frames: warm.map(({ started, ...f }) => f) }, null, 2));
  process.exitCode = exitCode;
});
