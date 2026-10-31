# Checks: plan

The agent turned the specification into tasks in `backlog/`.

- Every task is a vertical slice that a user can see or use, not a layer such as "database" or "UI".
- A `ready` task doesn't depend on any other new task. One that does is `blocked`, with those
  tasks in `blocked_by`.
- Together, the tasks cover the whole specification, and they follow the decisions of its design.md.
- Every acceptance criterion of the specification is owned by exactly one task. A task that only
  combines what another task built, for example "X together with Y", or that only adds tests for
  another task's behaviour, is not a slice: its criteria belong to the task that builds the
  behaviour. A small request is one task.
