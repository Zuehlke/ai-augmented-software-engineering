---
name: create-project-documentation
agent: agent
description: Generate AI-friendly project documentation for this repository
---

# Role
You are assisting a developer working on their repository.

# Task
Create or update a small set of AI-friendly documentation files that help AI agents understand and work with the project.

## Constraints

- Do NOT fabricate information. If unsure, ask questions.
- Prefer facts that can be verified in the repository (files, folders, configs).
- Do not include secrets or sensitive/internal-only information.

## Outputs

Generate or update the following files (create them if missing):

### PROJECT_OVERVIEW.md

A high-level overview including:

- Purpose
- Environment
- Project structure
- Main Architectural concepts
- Integrations

Place this file in docs/.

### CODING_GUIDELINES.md

Document conventions derived from the repository:

- General Code style & formatting (do not duplicate existing style guides, e.g. `line-length = 120` - link to the files or mechanisms instead)
- Naming patterns
- Command executions (refer to maven, mise etc. where possible)
- Security practices

Use commands verified in:

- scripts
- Makefiles
- CI configs
- package manager configs

Place this file in docs/.

## Discovery approach

1. Scan documentation first:

- docs/
- doc/
- data/
- wiki/
- adr/ or ADRs/
- README.md
- CONTRIBUTING.md
- DEVELOPMENT.md
- RUNBOOK.md
- SECURITY.md
- AGENTS.md

2. Inspect manifests:

- package.json
- pom.xml
- pyproject.toml
- mise.toml
- requirements*.txt

3. Inspect tooling/config:

- Makefile
- Taskfile
- justfile
- .tool-versions
- mise.toml
- .nvmrc

Prefer using wrapper over raw commands, e.g. maven

4. Inspect CI/CD:

- .gitlab-ci.yml
- Jenkinsfile

5. Inspect container configs:

- Dockerfile
- Containerfile
- docker-compose*

## Explore repository structure

Infer:

- Tech stack
- Code organization
- Entry points
- Integrations
- Testing setup
- Deployment method

## Ask the user if necessary

- Project purpose / success criteria
- Organizational context
- Explanation of unusual patterns

---

## Writing Guidelines

- Merge existing files intelligently
- Write concise markdown
- Reference real files and directories
- Avoid generic advice
- Document only patterns observable in the repo
- List commands explicitly
- Ask the user if commands cannot be verified
- Avoid duplicating content - link to it instead (e.g. specific formatting rules or explicit versions)

---

## Validation Step

After generating docs:

- Re-scan the repository
- Verify components exist
- Verify commands match scripts or CI steps

Then clarify uncertainties or questions using the #askQuestions tool.