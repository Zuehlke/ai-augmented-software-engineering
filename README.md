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
- GitHub Copilot in the CLI or your IDE of choice (see ["Setting up GitHub Copilot for yourself"](https://docs.github.com/en/copilot/how-tos/set-up/set-up-for-self))

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
The exercises will be available during the training.