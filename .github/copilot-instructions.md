# Role and Behaviour
// TODO: Add more details about the role and behavior of the AI agent, including how it should interact with the repository and Dev.

# Project Documentation
Refer to the project documentation for information about the system, including architecture, technology stack, and project structure.
Primary documentation is located in the `docs/` directory.

All guidelines must be followed unless Dev explicitly approves an exception.

# Constraints
## Command Execution
- Prefer maven commands for repository workflows.
- Use direct tool commands only when no equivalent task target exists, or when diagnosing task-level failures.

## Git Rules
You must **not execute modifying git commands**.
You may use **read-only git commands** to inspect the repository state. All commits and repository modifications are performed by Dev.