# cmux LaTeX image middleware

This tree is the cmux integration of [TFormula](https://github.com/mikewang817/TFormula) 0.3.1. TFormula is MIT licensed, copyright Mike Wang. The upstream project stays at that repository; this publication adds the local middleware used to render LaTeX as images inside cmux.

TFormula sits on the local PTY. cmux terminals, including managed SSH sessions, start through it. Formulas are drawn as transparent images. The original characters stay in the terminal so they can still be copied. Plain parentheses, identifiers, backtick spans, and code fences stay text.

## What changed relative to upstream

- Transparent overlays (`TFORMULA_TRANSPARENT=1`) and strict math detection (`TFORMULA_STRICT=1`).
- Synchronized placement of cached formulas before a TUI releases its frame, including SSH and tmux fragments.
- Wider shallow rasters for Retina terminals, still within the previous total pixel budget.
- cmux launchers in `cmux/`.

`patches/cmux-integration.patch` is the same work as a diff against upstream `008265f`.

## Install

From a checkout:

```sh
./cmux/install.sh
```

Node.js 20 or newer and npm must already be on `PATH`. The installer does not search the home directory, read SSH keys, or send data anywhere. It writes only this account's launcher and shell hooks.

What it changes:

- `~/.local/bin/tformula`, only when that file is absent or was created by this installer. `--force` is required to replace a different `tformula`.
- The login shell's startup file (`~/.zshrc` or `~/.bashrc`). The hook runs only inside a local interactive cmux terminal.
- `BASH_ENV` for cmux-managed SSH. If `BASH_ENV` already points at another file, that file is sourced first. Bash started outside cmux is unchanged.
- On macOS, a per-user LaunchAgent so a Dock-launched cmux can see `BASH_ENV`. Quit and reopen cmux once after installing.

Open a new cmux terminal afterward. A terminal that is already open keeps its current shell.

`./cmux/install.sh --uninstall` removes the hooks and restores a previous `BASH_ENV` when one was saved. `CMUX_FORMULA_DISABLE=1`, or a file at `~/.config/tformula/disabled`, turns rendering off without uninstalling.

## Run from a checkout

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
