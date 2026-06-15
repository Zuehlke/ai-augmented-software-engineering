# AI-Augmented Software Engineering

This repo contains a Spring Boot API for managing flight information used in the lab exercises.

## Project Structure

```text
lab/
├── mvnw                                    # Maven wrapper script (macOS/Linux)
├── mvnw.cmd                                # Maven wrapper script (Windows)
├── Taskfile.yml                            # Cross-platform task commands
├── pom.xml                                 # Project metadata and dependencies
├── README.md                               # This file
└── src/
    ├── main/
    │   ├── java/
    │   │   └── com/zuhlke/lab/flights/
    │   │       ├── Application.java        # Spring Boot entry point
    │   │       ├── controller/             # REST endpoints
    │   │       ├── repository/             # Data access
    │   │       └── service/                # Business logic
    │   └── resources/                      # Configuration
    └── test/                               # Tests
```

## Quick Start

### Prerequisites

- Java 25
- Command runner [task](https://taskfile.dev/)
- GitHub Copilot in your IDE of choice (for example, the [GitHub Copilot JetBrains plugin](https://plugins.jetbrains.com/plugin/17718-github-copilot--your-ai-pair-programmer))

### Setup and Run

Start the application:

```bash
task run
```

The API is available at http://localhost:8080.

Swagger UI is available at http://localhost:8080/swagger-ui/index.html.

### Tasks
[Task](https://taskfile.dev/) is used to run commands irrespective of the underlying OS.

You can see the list of available commands by running:

```bash
task
```

## Exercises
The exercises will be available during the training.