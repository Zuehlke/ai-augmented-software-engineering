- `GET /delays.csv` returns the content type `text/csv`, and a `Content-Disposition` header that names the
  file `delays.csv`.
- The first row is `flight_number,airline,status,delay_minutes`. Every other row is one flight, with the
  same values as `GET /delays`. A missing delay is an empty field, not `null`.
- `GET /delays.csv?airline_code=LH` returns only that airline's flights, matched like `GET /delays`.
- An airline code without flights returns a file with only the header row, not `404`.
- Values that contain a comma or a quote are quoted as RFC 4180 describes.
- `GET /delays` answers exactly as before.
- Tests cover the header, the rows, the filter, the empty file, and the quoting.
