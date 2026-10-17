- `GET /airlines/{code}/delay-summary` returns `code`, `name`, `flights`, `onTime`, `delayed`, `cancelled`
  and `averageDelayMinutes`: the airline, its number of flights, and how many of them are on time,
  delayed and cancelled by their latest delay event.
- The average delay is the mean delay in minutes of the airline's delayed flights, by their latest event,
  as a number with decimals, not rounded to whole minutes.
- An airline without delayed flights has no average: `null`, not `0`.
- The code matches in any case. An unknown airline gives `404`.
- No existing endpoint changes.
- Tests cover the counts, the average, the airline without an average, the case, and the unknown airline.
