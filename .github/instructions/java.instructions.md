---
description: "Java development instructions"
# TODO: Add a glob pattern to match your Java source files using applyTo.
---

# Development methodology

- Follow Test-Driven Development (TDD).
- Prefer small, cohesive classes with clear responsibilities.
- Keep business logic out of controllers and framework glue code.
- Use dependency injection for services, repositories, clients, and external integrations.
- Prefer immutable objects and pure functions where practical.
- Keep methods focused, readable, and easy to change.
- Prefer composition over inheritance unless inheritance clearly models the domain.
- Avoid hidden side effects and global mutable state.
- Refactor when code smells appear.

# Code style

- Follow the project `.editorconfig` for formatting, indentation, line length, wrapping, spacing, imports, and IDE formatter behavior.
- Do not restate or override formatting rules from `.editorconfig`.
- Generate code that can be reformatted cleanly by the project IDE formatter.
- Prefer readable, maintainable Java over clever or overly compact code.
- Use descriptive names and avoid non-standard abbreviations.
- Avoid unnecessary comments; prefer clear names, simple control flow, and small methods.
- Add comments only when they explain intent, tradeoffs, or non-obvious behavior.
- Do not suppress warnings unless there is a clear reason.

# Java conventions

- Use explicit types unless `var` improves readability.
- Do not use `var` when it hides important domain meaning.
- Avoid raw types.
- Use generics where type safety is needed.
- Prefer immutable collections where appropriate.
- Use `Optional` for possibly absent return values, not for fields, parameters, or DTO properties.
- Avoid returning `null` from public methods where a clearer alternative exists.
- Avoid mutable static state.
- Use exceptions for exceptional cases, not normal control flow.
- Prefer domain-specific exception types for expected business failures.
- Keep public APIs explicit and stable.

# Naming conventions

- Follow existing project naming conventions.
- Use meaningful names based on domain language.
- Classes should describe concepts or roles, such as `ItemService`, `ItemController`, or `ItemRepository`.
- Methods should describe actions or queries, such as `createItem`, `findActiveItems`, or `validateRequest`.
- Constants should have clear names that explain their purpose.
- Exception classes should end with `Exception`.
- Request and response DTOs should use clear names such as `CreateItemRequest`, `UpdateItemRequest`, and `ItemResponse`.

# API endpoint design

- Use RESTful API design.
- Use plural resource names, for example `/items`, not `/item`.
- Use nouns for resources, not verbs.
- Use HTTP methods consistently:
  - `GET` for reads
  - `POST` for creation or command-like operations
  - `PUT` for full replacement
  - `PATCH` for partial update
  - `DELETE` for deletion
- Use query parameters for filtering, pagination, sorting, and optional inputs.
- Provide safe defaults for pagination.
- Avoid unbounded list endpoints.
- Validate request input before executing business logic.
- Keep controllers thin and delegate to services.
- Use DTOs for API requests and responses.
- Do not expose persistence entities (e.g. `Item`) directly through API responses.

# HTTP status codes

Use appropriate HTTP status codes:

- `200 OK` — successful read or update operation
- `201 Created` — successful resource creation
- `204 No Content` — successful operation with no response body
- `400 Bad Request` — invalid request input not covered by validation
- `401 Unauthorized` — authentication required
- `403 Forbidden` — authenticated user is not allowed to perform the operation
- `404 Not Found` — resource does not exist
- `409 Conflict` — request conflicts with current resource state
- `422 Unprocessable Entity` — syntactically valid request with semantic validation errors
- `500 Internal Server Error` — unexpected system error

# Error handling

- Never expose internal stack traces or sensitive system details.
- Map domain errors to appropriate HTTP status codes.
- Use specific exception types for expected failures.
- Prefer centralized exception handling, such as `@ControllerAdvice` in Spring.
- Return consistent error responses across endpoints.
- Include a stable error code when useful for API clients.
- Keep error messages helpful but safe.
- Log unexpected errors with useful context.
- Never log secrets, tokens, passwords, or sensitive personal data.

# Response structure

- Keep response structures consistent across endpoints.
- Use records for response bodies.
- Use clear, stable field names.
- Use ISO-8601 values for date/time fields.
- For paginated endpoints, include pagination metadata such as `limit`, `offset`, and `total`.
- Do not leak internal implementation details through API responses.

# Common patterns

## Controllers

- Keep controllers focused on HTTP concerns:
  - request mapping
  - request validation
  - response status
  - delegation to services
- Do not put business logic in controllers.
- Prefer constructor injection.
- Use validation annotations for request validation where appropriate.

```java
@RestController
@RequestMapping("/items")
class ItemController {

    private final ItemService itemService;

    ItemController(ItemService itemService) {
        this.itemService = itemService;
    }

    @GetMapping
    List<ItemResponse> findItems(@RequestParam String status) {
        return itemService.findByStatus(status);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    ItemResponse createItem(@RequestBody @Valid CreateItemRequest request) {
        return itemService.create(request);
    }
}
```

## Services

- Put business rules in service classes.
- Keep services easy to understand and reuse.
- Validate business invariants in services.
- Keep transaction boundaries explicit.
- Avoid leaking persistence details into controllers.

```java
@Service
class ItemService {

    private final ItemRepository itemRepository;

    ItemService(ItemRepository itemRepository) {
        this.itemRepository = itemRepository;
    }

    List<ItemResponse> findByStatus(String status) {
        return itemRepository.findByStatus(status).stream()
                .map(ItemResponse::from)
                .toList();
    }
}
```

## DTOs and models

- **Prefer Java records** for DTOs and response objects — they are immutable and concise.
- Keep request DTOs separate from response DTOs.
- Keep API DTOs separate from persistence entities (e.g. the `Item` record in `repository/`).
- Use validation annotations on request DTOs where appropriate.
- Avoid exposing internal IDs or implementation details unless required by the API contract.

```java
// Request DTO
record CreateItemRequest(
        @NotBlank String name,
        @NotBlank String category,
        @NotNull LocalDateTime createdAt
) {}

// Response DTO — maps from the Item entity
record ItemResponse(
        Long id,
        String name,
        String category,
        String status,
        Integer quantity
) {
    static ItemResponse from(Item item) {
        return new ItemResponse(
                item.id(),
                item.name(),
                item.category(),
                item.status(),
                item.quantity()
        );
    }
}
```

## Repositories

- Extend `ListCrudRepository<T, ID>` from Spring Data JDBC.
- Keep repositories focused on persistence.
- Do not put business logic in repositories.
- Use clear method names following Spring Data query derivation conventions.
- Prefer parameterized queries.
- Never build SQL using string concatenation with user input.

```java
public interface ItemRepository extends ListCrudRepository<Item, Long> {

    List<Item> findByStatus(String status);

    List<Item> findByCategoryAndStatus(String category, String status);
}
```

# When editing existing code

- Preserve the project's existing architecture and framework choices.
- Follow existing naming, layering, and dependency patterns.
- Do not introduce new dependencies unless necessary.
- Do not rewrite unrelated code.
- Keep changes small and focused.
- Prefer local, understandable improvements over broad rewrites.