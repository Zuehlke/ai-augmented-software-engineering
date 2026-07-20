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

### New or Changed Endpoint

Use this path when adding or changing a controller endpoint.

Required coverage:
- Add or update a unit test for every service class involved using JUnit + Mockito.
- Add or update a controller test for the endpoint using @WebMvcTest.
- Cover successful requests, validation failures, missing required parameters, invalid parameter values, not-found cases, response codes, and key response body fields.
- Include MockMvc tests in the normal test run.

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

A Java change is ready only when every modified behavior has matching tests, any required endpoint coverage is present, and mvn test passes. If a test type is intentionally omitted, document the omission and get Dev approval.