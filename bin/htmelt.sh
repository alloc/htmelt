#!/bin/bash

function spawnCLI() {
  local ENTRY="$(readlink -f "$0")/../../dist/cli.mjs"

  # Enable source maps when executed via local clone.
  if [[ "$ENTRY" != *"node_modules"* ]]; then
    export NODE_OPTIONS="--enable-source-maps"
  fi

  node "$ENTRY" "$@" || spawnCLI "$@"
}

spawnCLI "$@"