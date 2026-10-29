# cmux LaTeX image middleware

This tree is the cmux integration of [TFormula](https://github.com/mikewang817/TFormula) 0.3.1. TFormula is MIT licensed, copyright Mike Wang. The upstream project stays at that repository; this publication adds the local middleware used to render LaTeX as images inside cmux.

TFormula sits on the local PTY. cmux terminals, including managed SSH sessions, start through it. Formulas are drawn as transparent images. The original characters stay in the terminal so they can still be copied. Plain parentheses, identifiers, backtick spans, and code fences stay text.

## What changed relative to upstream

- Transparent overlays (`TFORMULA_TRANSPARENT=1`) and strict math detection (`TFORMULA_STRICT=1`).
- Synchronized placement of cached formulas before a TUI releases its frame, including SSH and tmux fragments.
- Wider shallow rasters for Retina terminals, still within the previous total pixel budget.
- cmux launchers in `cmux/`.

`patches/cmux-integration.patch` is the same work as a diff against upstream `008265f`.

## Run

```sh
npm install
npm run build
export TFORMULA_BIN="$PWD/dist/cli.js"
```

Interactive local cmux shells can `exec` `cmux/cmux.zsh` near the end of `~/.zshrc`. cmux starts managed SSH from noninteractive Bash; point `BASH_ENV` at `cmux/cmux-bash-env.sh` for those surfaces.

```sh
export TFORMULA_BIN=/path/to/dist/cli.js
# interactive zsh
source /path/to/cmux/cmux.zsh
```

`CMUX_FORMULA_DISABLE=1` skips the middleware. `CMUX_FORMULA_DEBUG=1` passes `--debug`. A file at `~/.config/tformula/disabled` also turns it off. Remote shells (`SSH_CONNECTION` set) are not wrapped again.

`tools/cmux-latex` is a separate one-shot renderer. It turns a single expression into a Kitty graphics image with local KaTeX and headless Chrome. It does not replace formulas printed by other programs.

```sh
cd tools/cmux-latex
npm install
node render.mjs '\int_0^\infty e^{-x^2}\,dx'
```
