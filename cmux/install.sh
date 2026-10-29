#!/bin/sh
# One-shot installer for the cmux LaTeX image middleware.
# New cmux terminals pick it up. An already open terminal stays as it is.
set -eu

usage() {
  cat <<'EOF'
Usage: ./cmux/install.sh [--dry-run] [--no-build] [--uninstall]

Builds this checkout, installs ~/.local/bin/tformula, and hooks cmux:
  interactive zsh      ~/.zshrc sources the cmux wrapper
  managed SSH          BASH_ENV runs the same wrapper before bash -c

Open a new cmux terminal after installing. Set CMUX_FORMULA_DISABLE=1
or create ~/.config/tformula/disabled to turn rendering off.
EOF
}

log() { printf '%s\n' "$*"; }
die() { printf 'cmux-tformula: %s\n' "$*" >&2; exit 1; }

dry_run=0
do_build=1
uninstall=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --no-build) do_build=0 ;;
    --uninstall) uninstall=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
root=$(CDPATH= cd -- "$script_dir/.." && pwd)
config_dir=${XDG_CONFIG_HOME:-$HOME/.config}/tformula
bin_dir=$HOME/.local/bin
zshrc=$HOME/.zshrc
zshenv=$HOME/.zshenv
begin='# >>> cmux-tformula >>>'
end='# <<< cmux-tformula <<<'
agent_label=com.cmux-tformula.env
agent_plist=$HOME/Library/LaunchAgents/$agent_label.plist
bash_env=$config_dir/cmux-bash-env.sh

run() {
  if [ "$dry_run" -eq 1 ]; then
    printf 'would run:'
    printf ' %s' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

ensure_marked_block() {
  file=$1
  block=$2
  if [ "$dry_run" -eq 1 ]; then
    log "would update $file"
    return 0
  fi
  [ -f "$file" ] || : >"$file"
  tmp=$(mktemp)
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' "$file" >"$tmp"
  printf '\n%s\n%s\n%s\n' "$begin" "$block" "$end" >>"$tmp"
  mv "$tmp" "$file"
}

remove_marked_block() {
  file=$1
  [ -f "$file" ] || return 0
  if [ "$dry_run" -eq 1 ]; then
    log "would remove cmux-tformula block from $file"
    return 0
  fi
  tmp=$(mktemp)
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' "$file" >"$tmp"
  mv "$tmp" "$file"
}

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  if [ -n "${NVM_BIN:-}" ] && [ -x "$NVM_BIN/node" ]; then
    printf '%s\n' "$NVM_BIN/node"
    return 0
  fi
  found=$(find "$HOME/.nvm/versions/node" -path '*/bin/node' -type f 2>/dev/null | sort | tail -n 1 || true)
  if [ -n "$found" ]; then
    printf '%s\n' "$found"
    return 0
  fi
  return 1
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

write_launcher() {
  node_bin=$1
  if [ "$dry_run" -eq 1 ]; then
    log "would install $bin_dir/tformula -> $node_bin $root/dist/cli.js"
    return 0
  fi
  mkdir -p "$bin_dir" "$config_dir"
  quoted_node=$(shell_quote "$node_bin")
  quoted_cli=$(shell_quote "$root/dist/cli.js")
  cat >"$bin_dir/tformula" <<EOF
#!/bin/sh
# cmux-tformula-managed
if [ -n "\${CMUX_WORKSPACE_ID:-}" ]; then
  export TFORMULA_TRANSPARENT="\${TFORMULA_TRANSPARENT:-1}"
  export TFORMULA_STRICT="\${TFORMULA_STRICT:-1}"
fi
exec $quoted_node $quoted_cli "\$@"
EOF
  chmod 755 "$bin_dir/tformula"
  cat >"$bin_dir/cmux-formula-shell" <<EOF
#!/bin/sh
# cmux-tformula-managed
export SHELL="\${SHELL:-/bin/zsh}"
if [ "\${CMUX_FORMULA_DISABLE:-}" = 1 ] || [ "\${TFORMULA_ACTIVE:-}" = 1 ]; then
  exec "\$SHELL" -l
fi
set --
if [ "\${CMUX_FORMULA_DEBUG:-}" = 1 ]; then
  set -- --debug
fi
"$bin_dir/tformula" "\$@" --shell
formula_status=\$?
if [ "\$formula_status" -ne 0 ]; then
  printf '\\nTFormula exited (%s); opening a plain shell.\\n' "\$formula_status" >&2
  export CMUX_FORMULA_DISABLE=1
  exec "\$SHELL" -l
fi
exit 0
EOF
  chmod 755 "$bin_dir/cmux-formula-shell"
  cat >"$config_dir/cmux.zsh" <<EOF
# cmux-tformula-managed
# Wrap interactive local cmux shells. Remote shells and an already wrapped shell pass through.
if [[ -o interactive && -t 0 && -t 1 \\
      && -n \${CMUX_WORKSPACE_ID:-} && -z \${SSH_CONNECTION:-} \\
      && \${TFORMULA_ACTIVE:-} != 1 && \${CMUX_FORMULA_DISABLE:-} != 1 \\
      && ! -e ${config_dir}/disabled \\
      && -x ${bin_dir}/cmux-formula-shell ]]; then
  exec "${bin_dir}/cmux-formula-shell"
fi
EOF
  cat >"$bash_env" <<EOF
# cmux-tformula-managed
# cmux starts managed SSH with noninteractive Bash. This file runs first.
if [ -n "\${CMUX_WORKSPACE_ID:-}" ] \\
  && [ -z "\${SSH_CONNECTION:-}" ] \\
  && [ "\${TFORMULA_ACTIVE:-}" != 1 ] \\
  && [ "\${CMUX_FORMULA_DISABLE:-}" != 1 ] \\
  && [ ! -e "${config_dir}/disabled" ] \\
  && [ -n "\${BASH_EXECUTION_STRING:-}" ] \\
  && [ -t 0 ] && [ -t 1 ] \\
  && [ -x "${bin_dir}/tformula" ]; then
  _cmux_formula_flags=
  if [ "\${CMUX_FORMULA_DEBUG:-}" = 1 ]; then
    _cmux_formula_flags=--debug
  fi
  # shellcheck disable=SC2086
  exec "${bin_dir}/tformula" \$_cmux_formula_flags -- \\
    /bin/bash --noprofile --norc -c "\$BASH_EXECUTION_STRING" "\$0" "\$@"
fi
EOF
}

install_shell_hooks() {
  zsh_block='[[ -r "$HOME/.config/tformula/cmux.zsh" ]] && source "$HOME/.config/tformula/cmux.zsh"'
  if [ -f "$zshrc" ] && grep -q 'config/tformula/cmux.zsh' "$zshrc"; then
    log "zshrc already sources the cmux wrapper"
  else
    ensure_marked_block "$zshrc" "$zsh_block"
  fi
  ensure_marked_block "$zshenv" "export BASH_ENV=\"\$HOME/.config/tformula/cmux-bash-env.sh\""
}

install_launch_agent() {
  case "$(uname -s)" in
    Darwin) ;;
    *) log "skipped LaunchAgent on $(uname -s); BASH_ENV is still exported from ~/.zshenv"; return 0 ;;
  esac
  if [ "$dry_run" -eq 1 ]; then
    log "would install $agent_plist and set BASH_ENV"
    return 0
  fi
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$agent_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$agent_label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>BASH_ENV</string>
    <string>$bash_env</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF
  domain="gui/$(id -u)"
  launchctl bootout "$domain" "$agent_plist" >/dev/null 2>&1 || true
  launchctl bootstrap "$domain" "$agent_plist"
  launchctl setenv BASH_ENV "$bash_env"
}

uninstall_all() {
  remove_marked_block "$zshrc"
  remove_marked_block "$zshenv"
  if [ "$dry_run" -eq 1 ]; then
    log "would remove managed launchers and BASH_ENV"
    return 0
  fi
  for file in "$bin_dir/tformula" "$bin_dir/cmux-formula-shell" "$config_dir/cmux.zsh" "$bash_env"; do
    if [ -f "$file" ] && grep -q 'cmux-tformula-managed' "$file"; then
      rm -f "$file"
    fi
  done
  if [ "$(uname -s)" = Darwin ] && [ -f "$agent_plist" ]; then
    launchctl bootout "gui/$(id -u)" "$agent_plist" >/dev/null 2>&1 || true
    launchctl unsetenv BASH_ENV >/dev/null 2>&1 || true
    rm -f "$agent_plist"
  fi
  log "Removed the cmux-tformula hooks. New cmux terminals will start plain shells."
}

if [ "$uninstall" -eq 1 ]; then
  uninstall_all
  exit 0
fi

node_bin=$(find_node) || die "Node.js 20 or newer is required."
node_major=$("$node_bin" -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 20 ] || die "Node.js 20 or newer is required (found $("$node_bin" -v))."

if [ "$do_build" -eq 1 ]; then
  log "Building $root"
  if [ "$dry_run" -eq 1 ]; then
    log "would run npm ci && npm run build"
  else
    (cd "$root" && "$node_bin" "$(dirname "$node_bin")/npm" ci && "$node_bin" "$(dirname "$node_bin")/npm" run build)
  fi
fi
if [ "$dry_run" -eq 0 ] && [ ! -f "$root/dist/cli.js" ]; then
  die "dist/cli.js is missing. Run without --no-build."
fi

write_launcher "$node_bin"
install_shell_hooks
install_launch_agent

log "Installed. Open a new cmux terminal to render formulas."
log "Disable with CMUX_FORMULA_DISABLE=1 or by creating $config_dir/disabled"
