#!/usr/bin/env bash
# Imprime el directorio bin de un Node suficientemente nuevo para Vite, o nada
# si el `node` del PATH ya sirve. Existe porque nvm/gvm suelen dejar en el PATH
# una version vieja y `make dev` no tendria que depender de que te acuerdes de
# correr `nvm use`.
set -euo pipefail

MIN_MAJOR=20

major_of() {
  local bin="$1"
  "$bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

# 1) El node del PATH, si alcanza.
if command -v node >/dev/null 2>&1; then
  if [ "$(major_of "$(command -v node)")" -ge "$MIN_MAJOR" ]; then
    exit 0
  fi
fi

# 2) La version mas nueva instalada con nvm.
if [ -d "${NVM_DIR:-$HOME/.nvm}/versions/node" ]; then
  best=""
  best_major=0
  for dir in "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin; do
    [ -x "$dir/node" ] || continue
    m="$(major_of "$dir/node")"
    if [ "$m" -ge "$MIN_MAJOR" ] && [ "$m" -ge "$best_major" ]; then
      best="$dir"
      best_major="$m"
    fi
  done
  if [ -n "$best" ]; then
    echo "$best"
    exit 0
  fi
fi

# 3) Homebrew.
for dir in /opt/homebrew/bin /usr/local/bin; do
  if [ -x "$dir/node" ] && [ "$(major_of "$dir/node")" -ge "$MIN_MAJOR" ]; then
    echo "$dir"
    exit 0
  fi
done

echo "acapelius: hace falta Node >= ${MIN_MAJOR} y no encontre ninguno (proba 'nvm install 22')." >&2
exit 1
