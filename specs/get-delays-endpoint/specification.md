# Specification - Delays endpoint (GET /delays)

## Context & goal

Provide a read-only HTTP endpoint that returns delayed flights for a given airline. The endpoint must be deterministic, testable, and align with existing project conventions (camelCase JSON, Spring Boot). This document captures research-phase decisions and acceptance criteria so the implementation agent can proceed.

## Requirements

### Must-have
- Endpoint: `GET /delays` with query parameters `airline_code` and `limit`.
- `airline_code` is required and must match the stored `AIRLINE` values (e.g. `SWISS`, `DELTA`).
- `limit` is optional, defaults to `50` if omitted, must be an integer > 0.
- Return only flights for the given airline that are delayed (`STATUS` = `DELAYED` and `DELAY_MINUTES` is not null).
- Results ordered by `delayMinutes` descending (largest delay first).
- Success: `200 OK` with `application/json` body — an array of delay DTOs (possibly empty) when the airline exists.
- Not found: `404 Not Found` when the airline does not exist in the dataset.

### Nice-to-have
- Return pagination headers (`X-Total-Count`) or support offset-based pagination.
- Accept case-insensitive `airline_code` values and normalise internally.
- OpenAPI/Swagger documentation annotations for the endpoint and DTO.

### Non-goals
- Authentication/authorization.
- Supporting IATA 2-letter codes mapping (out of scope for this exercise).
- Persisting any changes — endpoint is read-only.

## Constraints / Non-functional requirements
- JSON field names must use camelCase to match project conventions.
- Keep response DTO minimal (delay-focused) to decouple clients from internal schema changes.
- The endpoint must be deterministic for identical requests.

## Assumptions
- The dataset is the in-memory H2 database seeded from `data.sql`.
- Stored `AIRLINE` values are the canonical identifiers for airline matching.
- Clients expect a simple array response for successful requests.

## Open questions / risks
- Risk: Clients may expect IATA codes (e.g., `AA`) while the dataset stores full airline names; for this lab we match stored `AIRLINE` values.
- Risk: Returning an empty array vs 404 for airlines with zero delayed flights — resolved: empty array when airline exists but has no delayed flights; 404 when airline does not exist.

## Acceptance criteria
1. Request: `GET /delays?airline_code=DELTA&limit=50`
   - If `DELTA` exists in the data store, response is `200 OK`, `Content-Type: application/json`, body is a JSON array of up to `limit` delay DTOs ordered by `delayMinutes` desc.
   - If `DELTA` does not exist at all, response is `404 Not Found`.
2. `airline_code` missing or empty: return `400 Bad Request` (validation) — implementers may return validation error per framework defaults; tests should focus on defined 200/404 behaviors.
3. `limit` omitted: default to `50`. If `limit` is provided but <= 0 or non-numeric: return `400 Bad Request`.
4. Delay DTO (JSON) fields (all required for each item in array):
   - `flightNumber` (string)
   - `airline` (string)
   - `scheduledTime` (ISO 8601 timestamp)
   - `actualTime` (ISO 8601 timestamp or null)
   - `delayMinutes` (integer)

## Examples

Successful response (200):

```
HTTP/1.1 200 OK
Content-Type: application/json

[
  {
    "flightNumber": "DL95",
    "airline": "DELTA",
    "scheduledTime": "2024-02-28T23:45:00",
    "actualTime": null,
    "delayMinutes": 0
  },
  {
    "flightNumber": "DL123",
    "airline": "DELTA",
    "scheduledTime": "2024-02-28T22:00:00",
    "actualTime": "2024-02-28T22:20:00",
    "delayMinutes": 20
  }
]
```

Not found response (404):

```
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": "Airline not found",
  "airline_code": "UNKNOWN"
}
```

## Next agent must do

- [ ] Create an implementation plan and tests.
- Do NOT implement anything yet

---

Generated: 2026-06-21