Gate staff at an airport want to see the flights that leave from there. `GET /airports/{code}/departures`
should return the flights departing from that airport, by its IATA code in any case, sorted by scheduled
time, each with `flightNumber`, `airline`, `arrivalAirport`, `scheduledTime`, `status` and `delayMinutes`,
the last two as of the flight's current delay status. An airport without departures gives an empty list.
A code that isn't three letters is a bad request.
