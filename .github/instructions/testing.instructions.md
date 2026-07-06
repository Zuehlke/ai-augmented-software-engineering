---
description: "Testing instructions for Java code"
applyTo: "src/**/*.java"
---

# Testing Philosophy

* Follow Test-Driven Development (TDD).
* Every new or changed feature must include corresponding tests, added or updated **before** the work is considered complete.
* Test **behavior**, not internal implementation details.
* Each test verifies **one clear outcome**.
* Tests are **independent** and runnable in any order.
* Use descriptive names that explain the scenario and expected result.

# What Requires Tests

When you implement a new feature, change existing behavior, fix a bug, or add an endpoint, add or update tests to cover it.

**When adding an endpoint, both of the following are required — neither alone is sufficient:**

1. A **unit test** for every service class involved (`<Service>Test` using JUnit + Mockito).
2. A **controller test** for the new endpoint (`<Controller>Test` using `@WebMvcTest`).

## Business logic

Every service class must have a corresponding `<ServiceName>Test` unit test class. Add or update unit tests covering:

* The expected successful behavior.
* Relevant edge cases.
* Invalid input or error scenarios, including exception throwing.
* Boundary values where applicable.
* Bug regressions, when fixing a defect.

## API / controller behavior

Every controller must have a corresponding `<ControllerName>Test` using `@WebMvcTest`. Add or update controller tests covering:

* Successful requests.
* Validation failures and missing required parameters.
* Invalid parameter values.
* Not-found scenarios.
* Expected response status codes.
* Expected response body structure and important values.

# Test Types

| Scope | Tooling |
|---|---|
| Business logic (isolated) | JUnit + Mockito |
| Controller behavior with mocked collaborators | `@WebMvcTest(<Controller>.class)` |
| Integration across layers | `@SpringBootTest` + `@AutoConfigureMockMvc` |
| Repository-focused behavior | `@DataJdbcTest` (or equivalent slice) |

Use constructor or field injection only for Spring-managed test components (`MockMvc`, repositories, etc.). Include MockMvc tests in the normal test run.

# Test Organization

## File structure

```text
src/
└── test/
    ├── java/
    │   └── com/zuhlke/lab/...  # Test class location mirrors the main source tree
    └── resources/
        └── testdata/           # Optional test data files
```

## Naming conventions

| Element | Convention |
|---|---|
| Test class | `<Subject>Test` |
| Test method | `<methodName>_<givenCondition>_<expectedResult>` |

Examples:

```java
void isEven_evenAmount_returnsTrue()
void findItems_filterProvided_returnsResults()
void findItems_requiredParameterMissing_returnsBadRequest()
```

# Writing Tests

## Arrange – Act – Assert

Structure non-trivial tests with explicit `// arrange`, `// act`, `// assert` blocks. For simple tests, combine execution and verification into one `// act + assert` block, or omit the comments when the test is self-explanatory.

## Unit tests (business logic)

Use plain JUnit and Mockito for isolated business logic tests.

```java
class ItemServiceTest {

    private final ItemRepository itemRepository = mock(ItemRepository.class);
    private final ItemService itemService = new ItemService(itemRepository);

    @Test
    void getItemNameUpperCase_itemExists_returnsUpperCaseName() {
        // arrange
        Item item = new Item("it1", "Item 1", "This is item 1", 2000, true);
        when(itemRepository.findById("it1")).thenReturn(item);

        // act
        String result = itemService.getItemNameUpperCase("it1");

        // assert
        assertThat(result, is("ITEM 1"));
        verify(itemRepository).findById("it1");
    }

    @Test
    void getItemNameUpperCase_itemDoesNotExist_throwsException() {
        // arrange
        when(itemRepository.findById("missing")).thenReturn(null);

        // act + assert
        assertThrows(ItemNotFoundException.class, () -> itemService.getItemNameUpperCase("missing"));
    }
}
```

## Integration tests

```java
@SpringBootTest
@AutoConfigureMockMvc
class HealthEndpointTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void healthEndpoint_whenCalled_returnsUp() throws Exception {
        // act + assert
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }
}
```

## API endpoint tests

Successful GET requests:

```java
@Test
void findItems_filterExists_returnsOk() throws Exception {
    mockMvc.perform(get("/items").param("status", "active").param("limit", "10"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.count").isNumber())
            .andExpect(jsonPath("$.results").isArray());
}

@Test
void findItems_filterDoesNotExist_returnsNotFound() throws Exception {
    mockMvc.perform(get("/items").param("status", "archived"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message").exists());
}

@Test
void findItems_limitProvided_respectsLimit() throws Exception {
    int limit = 5;
    mockMvc.perform(get("/items").param("status", "active").param("limit", String.valueOf(limit)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results.length()").value(limit));
}
```

Input validation and error cases:

```java
@Test
void findItems_requiredParameterMissing_returnsBadRequest() throws Exception {
    mockMvc.perform(get("/items"))
            .andExpect(status().isBadRequest());
}

@Test
void findItems_limitNegative_returnsBadRequest() throws Exception {
    mockMvc.perform(get("/items").param("status", "active").param("limit", "-1"))
            .andExpect(status().isBadRequest());
}
```

## Parameterized tests

Use parameterized tests for repeated scenarios with different inputs.

```java
@ParameterizedTest
@CsvSource({
        "active, 200",
        "archived, 404"
})
void findItems_filterProvided_returnsExpectedStatus(String filter, int expectedStatus) throws Exception {
    mockMvc.perform(get("/items").param("status", filter))
            .andExpect(status().is(expectedStatus));
}
```

## Test independence

* Do not depend on test execution order.
* Prepare the required data in each test or via setup helpers / SQL scripts.
* Avoid shared mutable state, and do not rely on data created by another test.

## Descriptive assertions

Prefer assertions that explain the expected behavior.

```java
mockMvc.perform(get("/items").param("status", "active"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.results").isArray())
        .andExpect(jsonPath("$.count").value(greaterThan(0)));
```

# Completion Checklist

Before finishing any new or changed feature:

* [ ] File is in `src/test/java/...` and class is named `<Subject>Test`, `<Subject>Tests`, or `<Subject>TestCase`
* [ ] Unit tests are added or updated for all new or changed business logic
* [ ] Controller or integration tests are added or updated for all new or changed endpoint behavior
* [ ] Regression tests are added for bug fixes
* [ ] Test methods follow `<methodName>_<givenCondition>_<expectedResult>`
* [ ] Non-trivial tests use `// arrange`, `// act`, `// assert`
* [ ] Tests are independent and order-agnostic
* [ ] Success and error cases are covered
* [ ] Input validation paths are tested
* [ ] MockMvc tests are included in the normal test run
* [ ] All tests pass with `mvn test`
* [ ] No disabled or skipped tests exist without clear justification
* [ ] Any intentionally omitted test type is documented and approved by Dev