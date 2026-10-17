---
name: api-design
description: API design for endpoints, error handling, and response structures; use when designing or changing REST endpoints, status codes, error payloads, or DTO structures.
---

Keep endpoints RESTful, contracts explicit, and error handling centralized.

Leading word: contract.

## Resource design

- Use RESTful design with plural noun resources.
- Use nouns for resources, not verbs.
- Use HTTP methods consistently:
  - **GET** for reads
  - **POST** for create or command-like operations
  - **PUT** for full replacement
  - **PATCH** for partial update
  - **DELETE** for deletion
- Use query parameters for filtering, pagination, sorting, and optional inputs.

## Input validation

- Validate request input before business logic executes.
- Use validation annotations on request DTOs where appropriate.
- Return **400 Bad Request** for invalid input not covered by semantic validation.
- Return **422 Unprocessable Entity** for semantic validation failures on valid syntax.

## Pagination

- Provide safe defaults for pagination (e.g., limit, offset).
- Avoid unbounded list endpoints.
- Include metadata in paginated responses: `limit`, `offset`, `total`.

## Layer patterns

### Controllers

Controllers focus on HTTP concerns only:
- Request mapping
- Request validation
- Response status
- Delegation to services

Rules:
- Do not place business logic in controllers.
- Keep controllers thin.
- Prefer constructor injection.

### DTOs and Response Models

- Prefer Java records for DTOs and response objects.
- Keep request DTOs separate from response DTOs.
- Keep API DTOs separate from persistence entities.
- Use clear, stable field names.
- Use ISO-8601 values for date/time fields.
- Do not expose internal IDs or implementation details unless required.
- Do not expose persistence entities directly through API responses.

## Error handling and status mapping

Map domain errors to HTTP statuses intentionally:

| Status | Use Case |
|--------|----------|
| **200 OK** | Successful reads or updates |
| **201 Created** | Successful resource creation |
| **204 No Content** | Successful operations with no body |
| **400 Bad Request** | Invalid input (syntax) |
| **401 Unauthorized** | Authentication required |
| **403 Forbidden** | Authenticated but not allowed |
| **404 Not Found** | Resource missing |
| **409 Conflict** | Request state conflicts with current resource |
| **422 Unprocessable Entity** | Semantic validation failure (valid syntax, invalid semantics) |
| **500 Internal Server Error** | Unexpected system failures |

### Error response structure

- Keep response structures consistent across endpoints.
- Return consistent error response bodies (e.g., `{ "error": "...", "code": "..." }`).
- Include stable error codes when useful for API clients.
- Never expose stack traces or sensitive internal details.
- Keep error messages helpful but safe.
- Use centralized exception handling (e.g., `@ControllerAdvice`).
- Log unexpected errors with useful context.
- Never log secrets, tokens, passwords, or sensitive personal data.

## Response structure

- Keep response structures consistent across endpoints.
- Prefer records for response bodies.
- Use clear, stable field names.
- Use ISO-8601 values for date/time fields.
- For paginated responses, include metadata (`limit`, `offset`, `total`).
- Do not leak internal implementation details.
