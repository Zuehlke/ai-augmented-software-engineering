---
name: api-breaking-changes
description: Detect breaking changes in this Spring Boot project's REST API by diffing the OpenAPI 3 spec against a baseline, using the openapi-diff Maven plugin. Use this skill whenever you change an endpoint and need to know whether it breaks API consumers, when the user asks "is this a breaking change", or mentions API compatibility, versioning, or openapi-diff. Trigger it proactively when a change removes, renames, or retypes anything in the public API.
---

## Mandatory execution policy

- **DO NOT** provide a compatibility verdict without running the command and reading the report.

## Running the check

// TODO: Teach the agent to run the actual maven command

## Output

A summary of incompatible items from the report, or an explicit statement that none were found.