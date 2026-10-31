# Design - Flight delays dashboard

## Architectural design

- **Data model.** The flat `flights` table becomes three tables in `schema.sql`:
  - `airlines` (`CODE` primary key, `NAME`)
  - `flights` (`ID`, `FLIGHT_NUMBER`, `AIRLINE_CODE` referencing `airlines`, `DEPARTURE_AIRPORT`,
    `ARRIVAL_AIRPORT`, `SCHEDULED_TIME`), with an index on `AIRLINE_CODE`
  - `delay_events` (`ID`, `FLIGHT_ID` referencing `flights`, `STATUS`, `DELAY_MINUTES`, `ACTUAL_TIME`,
    `RECORDED_AT`), with an index on (`FLIGHT_ID`, `RECORDED_AT`)

  `data.sql` moves every existing row into them: one airline per flight number prefix, keeping today's
  airline name, one flight per row, one delay event per row.
- **Repositories** (Spring Data JDBC, in `repository/`, records like the existing `Flight`):
  `Airline` + `AirlineRepository`, `Flight` (reshaped) + `FlightRepository` with
  `findByAirlineCode` and `findByFlightNumber`, `DelayEvent` + `DelayEventRepository` with a query for a
  flight's latest event.
- **Latest event.** A flight's current status is its event with the latest `RECORDED_AT`. Two events with
  the same timestamp: the higher `ID` wins. A flight without events counts as on time.
- **`GET /delays`** keeps its contract: it builds the same `DelayView` (flight number, airline name,
  status, delay minutes) from a flight, its airline and its latest event.
- **`DashboardController`**, new, JSON for the page:
  - `GET /airlines/{code}/overview` returns the code, the name and the count of flights whose latest
    status isn't `CANCELLED`; `404` for an unknown code.
  - `GET /flights/{flightNumber}/status` returns the flight number, the latest status and the delay;
    `404` for an unknown flight number.
  - Codes and flight numbers are matched case-insensitively.
- **The page**, `src/main/resources/static/dashboard.html`: plain HTML and a small inline script. Each
  search box calls its endpoint and shows the result, or "not found" on a `404`.
- **Airport details** wait for the reference dataset: an `airports` table (`IATA_CODE`, `NAME`, `CITY`,
  `TIMEZONE`) loaded from it, and the flight status adds both airports' details, or marks them
  unavailable when the code has no entry.

## Files to change

- `src/main/resources/schema.sql`, `src/main/resources/data.sql`
- `src/main/java/com/zuhlke/lab/flights/repository/`: `Flight.java`, `FlightRepository.java`, new
  `Airline.java`, `AirlineRepository.java`, `DelayEvent.java`, `DelayEventRepository.java`
- `src/main/java/com/zuhlke/lab/flights/controller/DelaysController.java`, new `DashboardController.java`
- New `src/main/resources/static/dashboard.html`

## Test implementation plan

### Test files
- New `repository/DelayDataModelTest.java`, new `controller/DashboardControllerTest.java`, new
  `controller/DashboardPageTest.java`; the existing `controller/DelaysControllerTest.java` stays green.

### Test classes
- `DelayDataModelTest`: `@DataJdbcTest` against the real schema and data.
- `DashboardControllerTest`, `DashboardPageTest`: `@SpringBootTest` with `MockMvc`, like `DelaysControllerTest`.

### Test methods
- Data model: airlines by code, flights by airline, several events per flight, the latest event (also
  with equal timestamps), every former row present.
- Overview: a known code with its count, cancelled flights left out, an unknown code is `404`, a
  lower-case code.
- Flight status: on time, delayed with minutes, cancelled, an unknown flight number is `404`.
- Page: `/dashboard.html` is served and has both search boxes.

## Code implementation plan

### Source files
- As in Files to change.

### Functions/endpoints
- `GET /airlines/{code}/overview`, `GET /flights/{flightNumber}/status`; `GET /delays` unchanged on the
  outside.

### Helpers/utilities
- One place that picks a flight's latest event, used by `GET /delays` and `DashboardController`.

## Integration plan

- The page uses only the app's own endpoints and static resources: no build step, no new dependency.
- `README.md` lists the dashboard page and the two endpoints.
- The schema is recreated from `schema.sql` and `data.sql` at every start: there's no migration of
  existing databases.

## Validation plan

- `task test` passes, the existing `DelaysControllerTest` unchanged.
- Manually: `task run`, open `/dashboard.html`, look up `LX` and `LX100`, then an unknown code and an
  unknown flight number.
- Edge cases: lower-case input, a cancelled flight, a flight with two events at the same time.
- Error conditions: an unknown code or flight number shows "not found", never an error page.
