#!/usr/bin/env bash

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"

if [[ "$CMD" =~ (^|[[:space:]])git[[:space:]]+commit($|[[:space:]]) ]]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Do not commit; the developer will review and commit manually."}}'
fi

exit 0