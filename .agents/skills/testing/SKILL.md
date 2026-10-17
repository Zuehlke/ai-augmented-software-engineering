---
name: testing
description: Test-first Java coverage for src/**/*.java changes; use when the user adds or changes Java behavior, fixes a bug, or adds an endpoint.
---

Use this skill to keep Java changes covered by tests before the change is complete.

## Paths

### Feature and Bug Fix Coverage

Use this path for any change to src/**/*.java.

Apply these rules:
- Follow Test-Driven Development (TDD).
- Add or update tests before the change is considered complete.
- Test behavior, not internal implementation details.
- Keep each test focused on one clear outcome.
- Keep tests independent and order-agnostic.
- Use descriptive names that explain the scenario and expected result.
- Cover success paths, edge cases, invalid input, boundary values, and regressions.
- For each rule in the change, ask what a plausible wrong implementation would be (another key, another
  record, ignoring a null, ignoring a tie-break) and make sure one test fails for it.
- Each test creates the data it needs (stubbed in a unit test, inserted in a transaction that rolls back in
  an integration test). Never rely on, or change, shared seed data to reach a branch.

### New or Changed Endpoint

Use this path when adding or changing a controller endpoint.

Required coverage:
- Add or update a unit test for every service class involved using JUnit + Mockito.
- Add or update a controller test for the endpoint using @WebMvcTest.
- Cover successful requests, validation failures, missing required parameters, invalid parameter values, not-found cases, response codes, and key response body fields.
- Include MockMvc tests in the normal test run.
- For every parameter the change adds, cover it missing, blank, valid and invalid, on its own and
  together with each other parameter the endpoint accepts (including a valid value that matches nothing,
  and an invalid one next to an unknown one: say which error wins). Cover that the endpoint behaves as
  before when the new parameter is absent.
- For a path variable, "blank" means a whitespace segment and "missing" means an empty segment
  (`/x//y`). Pass such values as URI variables, `get("/x/{v}/y", " ")`, or as a built URI,
  `get(URI.create("/x/%20/y"))`. Never write `%20` into a template string: MockMvc encodes the `%` again.
- Validate input before any lookup, so an invalid value gives the same error whatever else was sent.

### Test Type Selection

Use these slices:
- Business logic: JUnit + Mockito.
- Controller behavior with mocked collaborators: @WebMvcTest.
- Cross-layer behavior: @SpringBootTest + @AutoConfigureMockMvc.
- Repository behavior: @DataJdbcTest or an equivalent slice.
- Use constructor or field injection only for Spring-managed test components.

### Test Structure

Use these conventions:
- Test classes should live under src/test/java and mirror the main package tree.
- Name test classes <Subject>Test.
- Name tests <methodName>_<givenCondition>_<expectedResult>.
- Use arrange, act, assert blocks for non-trivial tests.
- Prefer parameterized tests when the same assertion runs across multiple inputs.
- Prepare data in each test or via setup helpers or SQL; do not rely on test order.

## Completion Criterion

A Java change is ready only when every modified behavior has matching tests, any required endpoint coverage is present, and mvn test passes.