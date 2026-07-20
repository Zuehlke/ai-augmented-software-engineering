---
name: java
description: Java guidance for Spring Boot work; use when editing Java files, implementing or changing REST endpoints, modifying domain logic or shaping DTO/entity/repository boundaries.
---

Use this skill to keep Java API changes layered, test-first, and contract-safe.

Layered means:
- Controllers stay thin and HTTP-focused.
- Services hold business rules and invariants.
- Repositories stay persistence-focused.

## Paths

### Core Java Changes

Use this path for any edit in src/**/*.java.

Apply these defaults:
- Follow TDD and keep changes small and local.
- For Java test coverage rules and endpoint test requirements, use [SKILL.md](../testing/SKILL.md).
- Prefer small cohesive classes, focused methods, and composition over inheritance.
- Use dependency injection and avoid global mutable state.
- Prefer explicit types unless `var` improves readability without hiding domain meaning.
- Use generics, avoid raw types, and favor immutability where practical.
- Keep comments rare; add them only for intent, tradeoffs, or non-obvious behavior.

When API design or style details are uncertain, read [api-design](../api-design/SKILL.md).

### REST Endpoint Design

Use this path when adding or changing controllers, routes, request/response models, pagination, or status codes.

Execution target:
- Keep controllers thin and delegate to services.
- Use REST resource nouns with plural paths and consistent HTTP verbs.
- Validate request input before business logic.
- Return DTOs, never persistence entities.
- Apply consistent response structures and safe pagination defaults.

For full HTTP semantics and endpoint checklist, read [api-design](../api-design/SKILL.md).

### Error Handling and Contracts

Use this path when introducing exceptions, mapping failures, or revising API error payloads.

Execution target:
- Map domain failures to specific HTTP statuses.
- Use centralized exception handling.
- Keep error payloads consistent and safe.
- Log unexpected failures with context, never secrets.

For allowed status mappings and response safety rules, read [api-design](../api-design/SKILL.md).

## Completion Criterion

The change is done only when every modified Java artifact is accounted for against the layered boundary:
- Controller code contains only HTTP concerns and delegation.
- Service code contains business rules and invariants.
- Repository code contains only persistence concerns.
- API contracts use DTOs with stable field names and safe error semantics.