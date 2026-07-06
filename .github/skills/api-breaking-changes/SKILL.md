---
name: api-breaking-changes
description: Detect breaking changes in this Spring Boot project's REST API by diffing the OpenAPI 3 spec against a baseline, using the openapi-diff Maven plugin. Use this skill whenever you change an endpoint and need to know whether it breaks API consumers, when the user asks "is this a breaking change", or mentions API compatibility, versioning, or openapi-diff. Trigger it proactively when a change removes, renames, or retypes anything in the public API.
---

## Mandatory execution policy

- **MUST run** `mvn openapi-diff:diff` — do not guess or infer compatibility from code inspection alone.
- **DO NOT** provide a compatibility verdict without running the command and reading the report.

## Running the check

Run `mvn openapi-diff:diff`. All configuration (specs, output, fail conditions) is defined in `pom.xml`.

If the command fails or produces no report, stop and return: "Unable to determine compatibility; openapi-diff did not complete."

## Output

A summary of incompatible items from the report, or an explicit statement that none were found.