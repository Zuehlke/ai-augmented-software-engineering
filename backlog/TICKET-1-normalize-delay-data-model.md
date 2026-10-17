---
id: TICKET-1
status: ready
---

# Normalize delay data model

Delay data is restructured from a single flat table into separate airline, flight, and delay-event
data, so airline-level and flight-level questions can be answered correctly and efficiently instead
of by scanning one flat table.

## Acceptance Criteria

- Airline data (code, name) is stored and queryable independently of individual delay records.
- Flight data (flight id, airline, departure/arrival airport codes, schedule) is stored and
  queryable independently of individual delay records.
- Delay/status events (on time / delayed / cancelled, delay minutes, timestamp) are stored linked to
  a specific flight, with multiple events per flight supported.
- Existing data currently reachable via the flat `/delays` endpoint is fully represented in the new
  structure with no data loss.
- Querying "all flights for a given airline" and "current status for a given flight" can each be
  answered with a single, efficient lookup rather than a full-table scan.
