# Checks: design

The agent wrote the design for the specification, in `specs/<slug>/design.md`.

- Every acceptance criterion of the specification is served by the design: the modules, endpoints and
  tests it names.
- Nothing beyond the specification: no extra behaviour, endpoints, options or rules.
- The design follows the codebase around it: its structure, naming and error handling. Check that
  against the code, don't take the design's word for it.
- It names the tests to write before the code, and they cover every acceptance criterion.
- No literal code, and nothing called "optional" or "not needed".
- If the specification can be built in two ways that change what a user or caller sees, ask a question
  instead.
