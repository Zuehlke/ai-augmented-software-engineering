Support staff answer passenger questions about delays. Today they can only see the delays in the JSON of
`GET /delays`. They want them as a file to open in a spreadsheet: `GET /delays.csv` should return the
same flights as a CSV file named `delays.csv`, with a header row and one row per flight: flight number,
airline, status and delay in minutes. The `airline_code` filter works the same way. An airline code
without flights gives a file with only the header row.
