#!/usr/bin/env bash
# Runs once after the container is created (postCreateCommand). Each step runs even if an
# earlier one failed, so e.g. a network hiccup while downloading Temporal doesn't leave you
# without the agent CLIs. Any failed step is listed at the end and can be rerun on its own.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

failed=()
step() {
  echo "==> $1"
  shift
  "$@" || failed+=("$*")
}

# --- Needed for all labs --------------------------------------------------------------------
step "Installing the agent CLIs" npm install -g @anthropic-ai/claude-code @github/copilot
# Runs the tests once, so Maven caches everything `mvn test` needs, also inside the network-blocked sandbox.
step "Caching the Maven dependencies" mvn -q -B package

# --- Only needed from Lab 8 (Durable workflows) on -------------------------------------------
step "Installing Temporal and flows (Lab 8+)" bash .devcontainer/install-temporal.sh

if [ ${#failed[@]} -gt 0 ]; then
  echo >&2
  echo "These setup steps failed, rerun them in a terminal:" >&2
  printf '  %s\n' "${failed[@]}" >&2
  exit 1
fi
