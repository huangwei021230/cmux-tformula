#!/bin/sh
# Install the cmux LaTeX middleware for the current user.
# The script stays on this machine: it does not read SSH keys, shell history,
# or unrelated files, and it does not send anything off the computer.
set -eu

usage() {
  cat <<'EOF'
Usage: ./cmux/install.sh [--dry-run] [--no-build] [--force] [--uninstall]

Builds this checkout and hooks new cmux terminals for the account that runs it.

  ~/.local/bin/tformula              launcher, created only for this install
  ~/.config/tformula/cmux.zsh        interactive zsh inside cmux
  ~/.config/tformula/cmux.bash       interactive bash inside cmux
  ~/.config/tformula/cmux-bash-env.sh
                                     managed SSH, and only when cmux started bash

Node.js 20+ and npm must already be on PATH. An existing tformula command is
left in place unless it came from this installer or --force is given. An
existing BASH_ENV file is sourced first, then the cmux check runs.

Open a new cmux terminal after installing. Quit and reopen cmux once so a
Dock-launched app sees BASH_ENV. CMUX_FORMULA_DISABLE=1 or
~/.config/tformula/disabled turns rendering off.
EOF
}

log() { printf '%s\n' "$*"; }
die() { printf 'cmux-tformula: %s\n' "$*" >&2; exit 1; }

dry_run=0
do_build=1
uninstall=0
force=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --no-build) do_build=0 ;;
    --uninstall) uninstall=1 ;;
    --force) force=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
root=$(CDPATH= cd -- "$script_dir/.." && pwd)
config_dir=${XDG_CONFIG_HOME:-$HOME/.config}/tformula
bin_dir=$HOME/.local/bin
begin='# >>> cmux-tformula >>>'
end='# <<< cmux-tformula <<<'
agent_label=com.cmux-tformula.env
agent_plist=$HOME/Library/LaunchAgents/$agent_label.plist
bash_env=$config_dir/cmux-bash-env.sh
login_shell=${SHELL:-/bin/sh}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

ensure_marked_block() {
  file=$1
  block=$2
  if [ "$dry_run" -eq 1 ]; then
    log "would update the shell startup file for this account"
    return 0
  fi
  if [ -f "$file" ] && [ ! -w "$file" ]; then
    die "cannot write $file"
  fi
  [ -f "$file" ] || : >"$file"
  tmp=$(mktemp)
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' "$file" >"$tmp"
  awk 'NF == 0 { blank++; next } { for (i = 0; i < blank; i++) print ""; blank = 0; print }' "$tmp" >"$tmp.trimmed"
  printf '\n%s\n%s\n%s\n' "$begin" "$block" "$end" >>"$tmp.trimmed"
  mv "$tmp.trimmed" "$file"
  rm -f "$tmp"
}

remove_marked_block() {
  file=$1
  [ -f "$file" ] || return 0
  if [ "$dry_run" -eq 1 ]; then
    log "would remove the cmux-tformula block from a shell startup file"
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

saved_bash_env() {
  current=${BASH_ENV:-}
  if [ -z "$current" ] && [ "$(uname -s)" = Darwin ]; then
    current=$(launchctl getenv BASH_ENV 2>/dev/null || true)
  fi
  if [ -z "$current" ] || [ "$current" = "$bash_env" ]; then
    if [ -f "$bash_env" ]; then
      current=$(sed -n 's/^# saved-bash-env: //p' "$bash_env" | head -n 1)
    fi
  fi
  if [ -z "$current" ] || [ "$current" = "$bash_env" ]; then
    return 0
  fi
  printf '%s\n' "$current"
}

write_launcher() {
  node_bin=$1
  if [ -e "$bin_dir/tformula" ] && ! grep -q 'cmux-tformula-managed' "$bin_dir/tformula" && [ "$force" -ne 1 ]; then
    die "A tformula command is already installed. Re-run with --force to replace that file."
  fi
  if [ "$dry_run" -eq 1 ]; then
    log "would install the tformula launcher for this account"
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
node_bin=$quoted_node
if command -v node >/dev/null 2>&1; then
  node_bin=\$(command -v node)
fi
exec "\$node_bin" $quoted_cli "\$@"
EOF
  chmod 755 "$bin_dir/tformula"

  cat >"$bin_dir/cmux-formula-shell" <<EOF
#!/bin/sh
# cmux-tformula-managed
user_shell=\${SHELL:-/bin/sh}
if [ "\${CMUX_FORMULA_DISABLE:-}" = 1 ] || [ "\${TFORMULA_ACTIVE:-}" = 1 ]; then
  exec "\$user_shell" -l
fi
set --
if [ "\${CMUX_FORMULA_DEBUG:-}" = 1 ]; then
  set -- --debug
fi
"\$HOME/.local/bin/tformula" "\$@" --shell
formula_status=\$?
if [ "\$formula_status" -ne 0 ]; then
  printf '\\nTFormula exited (%s); opening a plain shell.\\n' "\$formula_status" >&2
  export CMUX_FORMULA_DISABLE=1
  exec "\$user_shell" -l
fi
exit 0
EOF
  chmod 755 "$bin_dir/cmux-formula-shell"

  cat >"$config_dir/cmux.zsh" <<'EOF'
# cmux-tformula-managed
# Interactive local cmux shells only. Remote shells pass through.
if [[ -o interactive && -t 0 && -t 1 \
      && -n ${CMUX_WORKSPACE_ID:-} && -z ${SSH_CONNECTION:-} \
      && ${TFORMULA_ACTIVE:-} != 1 && ${CMUX_FORMULA_DISABLE:-} != 1 \
      && ! -e ${XDG_CONFIG_HOME:-$HOME/.config}/tformula/disabled \
      && -x $HOME/.local/bin/cmux-formula-shell ]]; then
  exec "$HOME/.local/bin/cmux-formula-shell"
fi
EOF

  cat >"$config_dir/cmux.bash" <<'EOF'
# cmux-tformula-managed
# Interactive local cmux shells only. Remote shells pass through.
case $- in
  *i*) ;;
  *) return 0 2>/dev/null || exit 0 ;;
esac
if [ -t 0 ] && [ -t 1 ] \
  && [ -n "${CMUX_WORKSPACE_ID:-}" ] && [ -z "${SSH_CONNECTION:-}" ] \
  && [ "${TFORMULA_ACTIVE:-}" != 1 ] && [ "${CMUX_FORMULA_DISABLE:-}" != 1 ] \
  && [ ! -e "${XDG_CONFIG_HOME:-$HOME/.config}/tformula/disabled" ] \
  && [ -x "$HOME/.local/bin/cmux-formula-shell" ]; then
  exec "$HOME/.local/bin/cmux-formula-shell"
fi
EOF

  saved=$(saved_bash_env || true)
  saved_header=
  if [ -n "$saved" ]; then
    saved_q=$(shell_quote "$saved")
    saved_header="# saved-bash-env: $saved
if [ -r $saved_q ]; then
  . $saved_q
fi"
  fi
  cat >"$bash_env" <<EOF
#!/bin/sh
# cmux-tformula-managed
$saved_header
# Wrap only bash that local cmux started. Any other bash returns immediately.
if [ -n "\${CMUX_WORKSPACE_ID:-}" ] \\
  && [ -z "\${SSH_CONNECTION:-}" ] \\
  && [ "\${TFORMULA_ACTIVE:-}" != 1 ] \\
  && [ "\${CMUX_FORMULA_DISABLE:-}" != 1 ] \\
  && [ ! -e "\${XDG_CONFIG_HOME:-\$HOME/.config}/tformula/disabled" ] \\
  && [ -n "\${BASH_EXECUTION_STRING:-}" ] \\
  && [ -t 0 ] && [ -t 1 ] \\
  && [ -x "\$HOME/.local/bin/tformula" ]; then
  _cmux_formula_flags=
  if [ "\${CMUX_FORMULA_DEBUG:-}" = 1 ]; then
    _cmux_formula_flags=--debug
  fi
  # shellcheck disable=SC2086
  exec "\$HOME/.local/bin/tformula" \$_cmux_formula_flags -- \\
    /bin/bash --noprofile --norc -c "\$BASH_EXECUTION_STRING" "\$0" "\$@"
fi
EOF
  chmod 755 "$bash_env"
}

hook_startup() {
  zsh_block='[ -r "${XDG_CONFIG_HOME:-$HOME/.config}/tformula/cmux.zsh" ] && . "${XDG_CONFIG_HOME:-$HOME/.config}/tformula/cmux.zsh"'
  bash_block='[ -r "${XDG_CONFIG_HOME:-$HOME/.config}/tformula/cmux.bash" ] && . "${XDG_CONFIG_HOME:-$HOME/.config}/tformula/cmux.bash"'
  case "$login_shell" in
    */zsh|zsh)
      if [ -f "$HOME/.zshrc" ] && grep -q 'tformula/cmux.zsh' "$HOME/.zshrc"; then
        log "zsh startup already loads the cmux wrapper"
      else
        ensure_marked_block "$HOME/.zshrc" "$zsh_block"
      fi
      ;;
    */bash|bash)
      if [ -f "$HOME/.bashrc" ] && grep -q 'tformula/cmux.bash' "$HOME/.bashrc"; then
        log "bash startup already loads the cmux wrapper"
      else
        ensure_marked_block "$HOME/.bashrc" "$bash_block"
      fi
      ;;
      *)
      log "This login shell is not changed automatically. Source cmux.zsh or cmux.bash from its startup file."
      ;;
  esac
  case "$login_shell" in
    */zsh|zsh)
      ensure_marked_block "$HOME/.zshenv" 'export BASH_ENV="${XDG_CONFIG_HOME:-$HOME/.config}/tformula/cmux-bash-env.sh"'
      ;;
  esac
}

install_launch_agent() {
  case "$(uname -s)" in
    Darwin) ;;
    *)
      log "This operating system does not use a LaunchAgent. BASH_ENV is exported for zsh child processes."
      return 0
      ;;
  esac
  if [ "$dry_run" -eq 1 ]; then
    log "would set BASH_ENV for apps launched from this login session"
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
  remove_marked_block "$HOME/.zshrc"
  remove_marked_block "$HOME/.zshenv"
  remove_marked_block "$HOME/.bashrc"
  if [ "$dry_run" -eq 1 ]; then
    log "would remove the cmux-tformula hooks"
    return 0
  fi
  saved=$(saved_bash_env || true)
  for file in "$bin_dir/tformula" "$bin_dir/cmux-formula-shell" "$config_dir/cmux.zsh" "$config_dir/cmux.bash" "$bash_env"; do
    if [ -f "$file" ] && grep -q 'cmux-tformula-managed' "$file"; then
      rm -f "$file"
    fi
  done
  if [ "$(uname -s)" = Darwin ]; then
    if [ -f "$agent_plist" ]; then
      launchctl bootout "gui/$(id -u)" "$agent_plist" >/dev/null 2>&1 || true
      rm -f "$agent_plist"
    fi
    if [ -n "$saved" ]; then
      launchctl setenv BASH_ENV "$saved"
    else
      launchctl unsetenv BASH_ENV >/dev/null 2>&1 || true
    fi
  fi
  log "Removed the cmux-tformula hooks. New cmux terminals will start plain shells."
}

if [ "$uninstall" -eq 1 ]; then
  uninstall_all
  exit 0
fi

command -v node >/dev/null 2>&1 || die "Node.js 20 or newer must be on PATH."
command -v npm >/dev/null 2>&1 || die "npm must be on PATH."
node_bin=$(command -v node)
npm_bin=$(command -v npm)
node_major=$("$node_bin" -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 20 ] || die "Node.js 20 or newer is required (found $("$node_bin" -v))."

if [ "$do_build" -eq 1 ]; then
  log "Building the checkout"
  if [ "$dry_run" -eq 1 ]; then
    log "would run npm ci && npm run build"
  else
    (cd "$root" && "$npm_bin" ci && "$npm_bin" run build)
  fi
fi
if [ "$dry_run" -eq 0 ] && [ ! -f "$root/dist/cli.js" ]; then
  die "The build did not produce dist/cli.js."
fi

write_launcher "$node_bin"
hook_startup
install_launch_agent

log "Installed for this account. Open a new cmux terminal to render formulas."
log "Quit and reopen cmux once so managed SSH uses the new hook."
log "Disable with CMUX_FORMULA_DISABLE=1 or by creating ~/.config/tformula/disabled"
