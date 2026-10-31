---
id: TASK-3
status: blocked
blocked_by: TASK-1, TASK-2
---

# Flight status lookup

On the same dashboard page, support staff can enter a flight number and see its current status (on
time / delayed / cancelled) and its delay in minutes, without knowing the query API.

## Acceptance Criteria

- The dashboard page shows a search box for a flight number, alongside the existing airline search box.
- Submitting a valid flight number shows its current status as one of: on time, delayed, or cancelled.
- Submitting a valid flight number that is delayed shows the delay in minutes.
- Submitting a flight number that doesn't exist shows a clear "not found" message instead of an error
  page or a blank result.
- The result reflects the flight's latest delay/status event from real data, not a hand-entered or
  mocked value.
