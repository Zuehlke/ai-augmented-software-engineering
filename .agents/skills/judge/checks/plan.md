# Checks: plan

The agent turned the specification into tickets in `backlog/`.

- Every ticket is a vertical slice that a user can see or use, not a layer such as "database" or "UI".
- A `ready` ticket doesn't depend on any other new ticket. One that does is `blocked`, with those
  tickets in `blocked_by`.
- Together, the tickets cover the whole specification.
- Every acceptance criterion of the specification is owned by exactly one ticket. A ticket that only
  combines what another ticket built, for example "X together with Y", or that only adds tests for
  another ticket's behaviour, is not a slice: its criteria belong to the ticket that builds the
  behaviour. A small request is one ticket.
