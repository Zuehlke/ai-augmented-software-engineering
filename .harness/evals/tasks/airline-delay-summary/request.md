Operations want to compare airlines at a glance. `GET /airlines/{code}/delay-summary` should return, for
one airline, how many of its flights are on time, delayed and cancelled right now, and the average delay
of its delayed flights in minutes, as `code`, `name`, `flights`, `onTime`, `delayed`, `cancelled` and
`averageDelayMinutes`. An airline without delayed flights has no average. An unknown airline is not
found.
