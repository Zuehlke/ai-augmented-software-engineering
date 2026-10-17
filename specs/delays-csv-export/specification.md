# Support staff download the current delays as a CSV file

## Context

Support staff answer passenger questions about delays. Today they can only see the delays in the JSON response of `GET /delays`. They want them as a file to open in a spreadsheet.

## Acceptance Criteria

- `GET /delays.csv` returns the current delays as a CSV file, with the content type `text/csv` and a `Content-Disposition` header that names the file `delays.csv`.
- The first row holds the column names: `flight_number,airline,status,delay_minutes`. Every other row is one flight, with the same values as `GET /delays`.
- `GET /delays.csv?airline_code=LX` only returns the flights of that airline, matched the same way as `GET /delays?airline_code=LX`.
- An airline code without flights returns a file with only the header row, not `404`.
- Values that contain a comma or a quote are quoted as RFC 4180 describes.

## Non-goals

- Other file formats, for example Excel.
- Filters other than the airline.
