#!/usr/bin/env bash
#
# Rebuild native modules that yarn skips because `enableScripts` is false.
#
# Currently this only affects `better-sqlite3`: its prebuilt binary is fetched
# by a postinstall script (`prebuild-install`), so when build scripts are
# disabled `yarn install` leaves only source and the backend crashes at startup
# with "Could not locate the bindings file" (core.auth -> core.httpRouter),
# taking down the kubernetes / notifications / signals plugins.
#
# Run this once after every `yarn install`:  yarn rebuild:native
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/node_modules/better-sqlite3"

if [[ ! -d "$PKG" ]]; then
  echo "error: $PKG not found — run 'yarn install' first." >&2
  exit 1
fi

# 1. Locate node-gyp. The system one (/usr/bin/node-gyp) can have a broken
#    Python gyp module, so prefer the copy bundled inside the active npm.
NPM_ROOT="$(npm root -g 2>/dev/null || true)"
NODE_GYP="$NPM_ROOT/npm/node_modules/node-gyp/bin/node-gyp.js"
if [[ -f "$NODE_GYP" ]]; then
  GYP_CMD=(node "$NODE_GYP")
elif command -v node-gyp >/dev/null 2>&1; then
  echo "warning: falling back to PATH node-gyp ($(command -v node-gyp))" >&2
  GYP_CMD=(node-gyp)
else
  echo "error: no node-gyp found (looked in npm root and PATH)." >&2
  exit 1
fi

# 2. better-sqlite3's gyp pins g++-11 / gcc-11 by name. If those aren't present,
#    shim them to whatever modern gcc/g++ is installed (>= 11 supports C++20).
SHIM_DIR=""
if ! command -v g++-11 >/dev/null 2>&1; then
  CXX_REAL=""
  CC_REAL=""
  for v in 14 13 12 11; do
    if command -v "g++-$v" >/dev/null 2>&1; then
      CXX_REAL="$(command -v "g++-$v")"
      CC_REAL="$(command -v "gcc-$v" || command -v "g++-$v")"
      break
    fi
  done
  # Fall back to the unversioned compilers if no g++-NN was found.
  [[ -z "$CXX_REAL" ]] && CXX_REAL="$(command -v g++ || true)"
  [[ -z "$CC_REAL"  ]] && CC_REAL="$(command -v gcc || true)"
  if [[ -z "$CXX_REAL" ]]; then
    echo "error: no C++ compiler found to shim as g++-11." >&2
    exit 1
  fi
  SHIM_DIR="$(mktemp -d)"
  ln -sf "$CXX_REAL" "$SHIM_DIR/g++-11"
  ln -sf "$CC_REAL"  "$SHIM_DIR/gcc-11"
  ln -sf "$CC_REAL"  "$SHIM_DIR/cc-11"
  export PATH="$SHIM_DIR:$PATH"
  echo "shimmed g++-11 -> $CXX_REAL"
fi
trap '[[ -n "$SHIM_DIR" ]] && rm -rf "$SHIM_DIR"' EXIT

echo "building better-sqlite3 (node $(node --version), ABI $(node -p process.versions.modules))..."
"${GYP_CMD[@]}" rebuild -C "$PKG"

# 3. Verify the addon actually loads.
node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.prepare('select 1').get();d.close();console.log('ok: better-sqlite3 '+require('better-sqlite3/package.json').version+' loads under node '+process.version)"
