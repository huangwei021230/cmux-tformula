# cmux launches managed SSH terminals through noninteractive Bash. BASH_ENV
# runs before that startup command, so the local PTY bridge is wrapped.
# Ordinary scripts, pipes, and the renderer's descendants pass through.
# Point TFORMULA_BIN at dist/cli.js or leave it as tformula on PATH.
if [ -n "${CMUX_WORKSPACE_ID:-}" ] \
  && [ -z "${SSH_CONNECTION:-}" ] \
  && [ "${TFORMULA_ACTIVE:-}" != 1 ] \
  && [ "${CMUX_FORMULA_DISABLE:-}" != 1 ] \
  && [ ! -e "${XDG_CONFIG_HOME:-$HOME/.config}/tformula/disabled" ] \
  && [ -n "${BASH_EXECUTION_STRING:-}" ] \
  && [ -t 0 ] && [ -t 1 ]; then
  tformula_bin="${TFORMULA_BIN:-tformula}"
  if [ -x "$tformula_bin" ] || command -v "$tformula_bin" >/dev/null 2>&1; then
    _cmux_formula_flags=
    if [ "${CMUX_FORMULA_DEBUG:-}" = 1 ]; then
      _cmux_formula_flags=--debug
    fi
    # shellcheck disable=SC2086
    exec "$tformula_bin" $_cmux_formula_flags -- \
      /bin/bash --noprofile --norc -c "$BASH_EXECUTION_STRING" "$0" "$@"
  fi
fi
