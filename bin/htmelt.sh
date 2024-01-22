#!/bin/bash

function findProgramPath() {
  local expression="require('path').dirname(require('fs').realpathSync('$0'))"
  local bin_dir=`node -e "process.stdout.write($expression)"`

  echo "$bin_dir/../dist/cli.mjs"
}

HTMELT_PATH="$(findProgramPath)"
HTMELT_SPAWN_TIME="0"

# Enable source maps when executed via local clone.
if [[ "$HTMELT_PATH" != *"node_modules"* ]]; then
  export NODE_OPTIONS="--enable-source-maps"
  echo "Enabling source maps."
fi

function run() {
  local now="$(date +%s)"
  local delta="$(($now - $HTMELT_SPAWN_TIME))"

  # Only respawn if >15 seconds have passed.
  if [[ "$delta" -gt "15" ]]; then
    HTMELT_SPAWN_TIME="$now"

    node "$HTMELT_PATH" "$@" || run "$@"
  fi
}

run "$@"
