# Support staff see the delay situation per airline and per flight on one web page

Support staff answer "is this flight delayed" and "how is this airline doing today" without querying
`GET /delays` by hand: one page served by the app shows an airline's overview and a flight's status.
To answer this correctly and efficiently, the flat delay table is split into airlines, flights and
delay events.

## Acceptance Criteria

- Airlines (code, name) are stored apart from the delay records, and an airline can be looked up by
  its code.
- Flights (flight number, airline, departure and arrival airport codes, schedule) are stored apart
  from the delay records.
- Delay and status events (on time / delayed / cancelled, delay in minutes, timestamp) are stored per
  flight, several per flight. A flight's current status is its latest event.
- Every flight `GET /delays` returns today is in the new structure, and `GET /delays` answers exactly
  as before, with and without `airline_code`.
- All flights of an airline, and the current status of a flight, are each found with one indexed
  lookup, not by scanning all delay records.
- The app serves one plain HTML page, `/dashboard.html`, with a search box for an airline code and one
  for a flight number.
- An existing airline code shows the airline's name and how many of its flights are active or
  scheduled, that is, not cancelled.
- An existing flight number shows its current status: on time, delayed or cancelled. A delayed flight
  also shows its delay in minutes.
- An airline code or a flight number that doesn't exist shows a clear "not found" message, not an error
  page or an empty result.
- The flight status shows the departure and arrival airport's name, city and timezone next to the IATA
  code. When the reference data has no entry for a code, the status and delay still show, with a note
  that the airport details are unavailable.
- What the page shows comes from the stored data, not from hand-entered or mocked values.

## Constraints

- One plain HTML page served by the app: no frontend framework, no separate build, no styling beyond
  the basics, no login.
- The airport reference data (name, city, timezone per IATA code) comes from a dataset the data team
  hasn't delivered yet, with no ETA. The airport details can't be built before it arrives.

## Non-goals

- Real-time push or streaming updates.
- A customer-facing UI.

## Assumptions

- The architecture review of the delay storage schema change is signed off, so the data model can
  change now.
- An airline code is the prefix of its flight numbers (`LX` for `LX100`), the way
  `GET /delays?airline_code=LX` matches today. The existing data stores airline names (`SWISS`), so
  the new airline data keeps both the code and the name.
- "Flight id" in the request means the flight number, for example `LX100`: that's what support staff
  know.

## Risks

- The airport dataset may arrive late or not at all. Everything else must work without it, so the
  airport details have to be a slice of their own that can wait.
