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

### LAB 3: Shaping the behavior using instruction files

**Context:** In this exercise, you will configure your project so GitHub Copilot produces more consistent and probabilistic outputs. Your goal is to reduce ambiguity and improve output quality by changing how the agent behaves and providing guidance.

**Task:**
- Describe the role and behavior of Copilot in `copilot-instructions.md`
- Specify the  glob pattern for the Java-specific instruction in `java.instructions.md`
- Implement the same endpoint again:
    - `GET /delays/?airline_code=AA&limit=50` → returns 200 OK or 404 Not Found

### LAB 4: Create your own research agent

**Context:** So far you've used Copilot to generate code directly. Now you will create your customized agent, that specifically supports you in gathering the requirements for the features you want to implement.

**Task:**
- Describe the task of our custom agent in `research.agent.md`. The agent should critically review a requirement, surface gaps, refine requirements, and write an improved spec.
- Ask your agent to create the specification for the endpoint:  `GET /delays/?airline_code=AA&limit=50` → returns 200 OK or 404 Not Found

### LAB 5: Implement a feature using spec-driven development

**Context:** We already created a spec using our research agent.  Now you will apply a full spec-driven workflow that uses the phases
- research,
- plan and
- implement

**Task:**
- Write the missing front matter for the agents in `research.agent.md`, `plan.agent.md` and `implement.agent.md` respectively.
- Implement the same endpoint again using the research-plan-implement workflow: `GET /delays/?airline_code=AA&limit=50` → returns 200 OK or 404 Not Found

### LAB 6: Implementing a feature using a SDD framework

**Context:** Instead of using our own research → plan → implement workflow, make yourself familiar with one publicly available SDD framework and implement the same feature using their workflow. Popular frameworks:
- [GSD](https://github.com/open-gsd/gsd-core)
- [OPENSPEC](https://openspec.dev/)
- [Spec Kit](https://github.com/github/spec-kit)

**Task:**
- Make yourself familiar with a SDD framework of your choice
- Implement the same endpoint again using their workflow: `GET /delays/?airline_code=AA&limit=50`

### LAB 7: Teach the agent to detect breaking API changes

**Context:** Using skills we can teach our agent specific capabilities. We will add a skill that helps the agent detect whether API changes are backward-compatible.

In our API spec (`src/main/resources/openapi.yaml`) we already prepared the following change:
- `GET /delays/?airline_code=AA&limit=50` to
- `GET /delays/?carrier_code=AA&limit=50`

**Task:**
- Update `api-breaking-changes/SKILL.md` so that the agents can detect breaking changes. We use [openapi-diff](https://github.com/OpenAPITools/openapi-diff) to spot API changes (you can run `mvn openapi-diff:diff` to get a report).
- Ask the default agent whether it sees an issue with the foreseen change