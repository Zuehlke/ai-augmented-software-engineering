# Checks: research

The agent turned the feature request into a specification in `specs/`.

- Every part of the feature request is covered, and nothing beyond it is added.
- Where the request leaves something open, there is a sensible assumption under Assumptions.
- No assumption or criterion changes a value the request defines (rounding, truncation, clamping,
  defaults). One that does is scope added beyond the request.
- If the request can be read in two ways that lead to different features, ask a question instead.
