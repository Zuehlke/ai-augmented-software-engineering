---
id: TASK-2
status: blocked
blocked_by: TASK-1
---

# Airline overview dashboard

Support staff can open a single web page, enter an airline code, and see that airline's name plus
how many of its flights are currently active or scheduled, without writing any query themselves.

## Acceptance Criteria

- A web page served by the app (no separate frontend build) is reachable and displays a search box
  for an airline code.
- Submitting a valid airline code shows the airline's name and a count of its currently active or
  scheduled flights.
- Submitting an airline code that doesn't exist shows a clear "not found" message instead of an
  error page or a blank result.
- The result is produced from a lookup against real airline/flight data, not hand-entered or mocked
  values.
