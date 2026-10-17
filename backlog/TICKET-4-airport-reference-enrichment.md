---
id: TICKET-4
status: blocked
blocked_by: TICKET-3
blocked_reason: an airport reference dataset (city, timezone per IATA code) that the data team has not yet delivered, with no ETA
---

# Airport reference enrichment for flight status

When looking up a flight's status, support staff see the departure and arrival airports' full name,
city, and timezone, instead of just the bare IATA codes.

## Acceptance Criteria

- The flight status lookup result shows, for both departure and arrival airports, the airport name,
  city, and timezone in addition to the IATA code.
- If airport reference data is missing for a given IATA code, the flight status lookup still
  displays the flight's status and delay, with a clear indication that airport details are
  unavailable rather than an error or blank fields.
