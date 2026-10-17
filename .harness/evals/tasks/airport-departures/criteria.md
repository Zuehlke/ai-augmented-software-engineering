- `GET /airports/{code}/departures` returns the flights whose departure airport is `code`, matched in any
  case, sorted by scheduled time, the earliest first.
- Each flight has its flight number, airline name, arrival airport, scheduled time, and the status and
  delay in minutes of its latest delay event.
- An airport with three letters but no departures gives `200` with an empty list.
- A code that isn't three letters gives `400`.
- No existing endpoint changes.
- Tests cover the departures and their order, the case, the empty list, and the bad request.
