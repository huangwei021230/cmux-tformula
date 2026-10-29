const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
process.stdin.setRawMode(true);
process.stdout.write("\x1b[?1049h");
const tmuxSplit = process.env.TFORMULA_SCROLL_FRAGMENTED === "tmux";
const fragmented = process.env.TFORMULA_SCROLL_FRAGMENTED === "1" || tmuxSplit;
for (let frame = 0; frame <= 12; frame++) {
  const text = `${fragmented && !tmuxSplit ? "" : "\x1b[?2026h"}\x1b[2J\x1b[HFRAME:${frame}\r\n`
    + "\r\n".repeat(frame % 3)
    + [1, 2, 3, 4].map((n) => `\\[\r\n\\frac{${n}}{${n + 1}}\r\n\\]\r\n\r\n`).join("");
  if (fragmented) {
    // tmux redraws can arrive without DEC 2026, split in the middle of TeX.
    const split = text.indexOf("frac") + 2;
    process.stdout.write(text.slice(0, split));
    if (tmuxSplit) process.stdout.write("\x1b[?2026l");
    await pause(3);
    process.stdout.write(text.slice(split, split + 23));
    await pause(3);
    process.stdout.write(text.slice(split + 23));
  } else process.stdout.write(text);
  await pause(2); // A frame end delivered in a separate PTY callback.
  if (!fragmented) process.stdout.write("\x1b[?2026l");
  await pause(frame === 0 ? 1400 : 90);
}
await pause(300);
process.stdout.write("\x1b[?1049l");
process.exit(0);
