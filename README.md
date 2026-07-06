# AI-Augmented Software Engineering

This repo contains a Spring Boot API for managing flight information used in the lab exercises.

## Project Structure

```text
lab/
├── mise.toml                               # Tool versions managed by mise
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

- Java 25, Maven 3 and Node 24 installed manually or managed with [mise](https://mise.jdx.dev/)
- [GitHub Copilot](https://docs.github.com/en/copilot) or [Claude Code](https://code.claude.com/docs/en/overview) setup and ready to use in your IDE (VS Code, IntelliJ) or CLI

### Setup and Run
Start the application:

```bash
mvn spring-boot:run
```

The application will start on port 8080 with Swagger UI available at http://localhost:8080/swagger-ui/index.html.

### Note on tooling

In this course we require Java, Maven and Node to be installed. 
You can either install them yourself or use [mise](https://mise.jdx.dev/) to manage versions specified in `mise.toml`.
Check out their [getting started guide](https://mise.jdx.dev/getting-started.html) for more information.

## Exercises
### LAB 1: Vibe Coding

**Context:** We are going to build an application that displays flight delays. You are given an initial Java project that starts successfully but does not yet expose the required REST endpoints. Familiarize yourself with the repo using GitHub Copilot and implement the endpoints described below.

**Task:** Implement the following endpoint:
- `GET /delays/?airline_code=AA&limit=50` → returns 200 OK or 404 Not Found

### LAB 2: Prompt Template

**Context:** You will generate project documentation for this repository using the prepared `create-project-documentation` prompt template.

**Task:** Create the documentation in chat using `/create-project-documentation`.
