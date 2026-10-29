# Wrap interactive local cmux shells, including the local side of ordinary ssh.
# Noninteractive commands, remote shells, and an already wrapped shell pass through.
# TFORMULA_BIN may be an executable path. It defaults to tformula on PATH.
if [[ -o interactive && -t 0 && -t 1 \
      && -n ${CMUX_WORKSPACE_ID:-} && -z ${SSH_CONNECTION:-} \
      && ${TFORMULA_ACTIVE:-} != 1 && ${CMUX_FORMULA_DISABLE:-} != 1 \
      && ! -e ${XDG_CONFIG_HOME:-$HOME/.config}/tformula/disabled ]]; then
  tformula_bin=${TFORMULA_BIN:-tformula}
  if [[ -x $tformula_bin ]] || command -v "$tformula_bin" >/dev/null 2>&1; then
    exec "$tformula_bin" ${CMUX_FORMULA_DEBUG:+--debug} --shell
  fi
fi
