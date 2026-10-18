---
id: TICKET-5
status: ready
---

# Support staff download the current delays as a CSV file

Support staff can download the current delays, optionally narrowed to one airline, as a `delays.csv`
file they open in a spreadsheet, holding the same flights and values they see in `GET /delays`.

## Acceptance Criteria

- `GET /delays.csv` returns the current delays as a CSV file, with the content type `text/csv` and a
  `Content-Disposition` header that names the file `delays.csv`.
- The first row holds the column names `flight_number,airline,status,delay_minutes`; every other row
  is one flight, with the same values as `GET /delays`.
- `GET /delays.csv?airline_code=LX` only returns the flights of that airline, matched the same way as
  `GET /delays?airline_code=LX`.
- An airline code without flights returns a file with only the header row, not `404`.
- Values that contain a comma or a quote are quoted as RFC 4180 describes.

## Assumptions

- The specification is small and delivers one demoable outcome, so it is a single ticket; it needs
  no prefactoring because `GET /delays` and its airline filter already exist, and it does not wait
  for the data-model rework in TICKET-1.
- A flight without a delay value (`null` in `GET /delays`) gets an empty `delay_minutes` field.
