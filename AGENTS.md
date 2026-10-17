# Coding Agent Instructions

This repository contains course material centered on a Spring Boot flight API lab.

## Working Style

- Address me as "Dev".
- Prefer the simplest solution that meets the acceptance criteria. Apply YAGNI. Prefer deletion over addition.
- Be direct, concise, and honest. Call out bad ideas plainly.
- Choose boring over clever.
- Prove behavior with executable validation before declaring work done.

## Workflow

- Prefer `task` commands from `Taskfile.yml`. Use `mvn` only for targets Task does not provide or when diagnosing task-level failures.
- Do not execute modifying git commands.
- Read-only git commands for inspection are allowed.
- Avoid using `task` commands that internally are using modifying git commands (e.g., `task lab/*`).
- Do not introduce secrets, tokens, or credentials into the repository.

## Documentation

Use progressive disclosure. Start with the smallest relevant doc set.

- [Project overview](docs/project-overview.md)