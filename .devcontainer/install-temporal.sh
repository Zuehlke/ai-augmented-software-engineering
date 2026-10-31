#!/usr/bin/env bash
# Only needed from Lab 8 (Durable workflows) on: installs the Temporal CLI and the `flows` command.
# The flows code in .harness/ only exists on the branches from Lab 8 on, so on earlier branches
# `flows` installs its dependencies the first time you run it there. Safe to rerun.
set -euo pipefail
devcontainer="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v temporal > /dev/null; then
  curl -sSf https://temporal.download/cli.sh | sh
  sudo ln -sf "$HOME/.temporalio/bin/temporal" /usr/local/bin/temporal
fi

sudo ln -sf "$devcontainer/bin/flows" /usr/local/bin/flows

# On the branches from Lab 8 on, install the dependencies right away
if [ -f "$devcontainer/../.harness/package.json" ]; then
  FLOWS_INSTALL_ONLY=1 flows
fi
