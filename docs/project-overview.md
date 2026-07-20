# Project Overview

`flight-api` is a Spring Boot REST API for managing and querying flight information.

## Environment

| Tool  | Version | Source                          |
|-------|---------|---------------------------------|
| Java  | 25      | `pom.xml` (`java.version`)       |
| Maven | 3       | Toolchain — check `task versions` |
| Node  | 24      | Toolchain — check `task versions` |

Run `task versions` to print the active Java / Maven / Node versions.

## Project structure

```
├── Taskfile.yml                            # Task runner (wraps Maven workflows)
├── pom.xml                                 # Maven build descriptor & dependencies
├── README.md                               # Quick-start guide and lab exercises
├── docs/                                   # AI-friendly project documentation
└── src/
    ├── main/
    │   ├── java/
    │   │   └── com/zuhlke/lab/flights/
    │   │       ├── Application.java        # Spring Boot entry point (@SpringBootApplication)
    │   │       ├── controller/             # REST controllers (HTTP layer)
    │   │       ├── repository/             # Spring Data JDBC repositories & entities
    │   │       └── service/                # Business logic
    │   └── resources/
    │       ├── application.yml             # App configuration (port, datasource, springdoc)
    │       ├── schema.sql                  # DDL – creates the `flights` table on startup
    │       └── data.sql                    # Seed data – 20 sample flight rows
    └── test/
        └── java/
            └── com/zuhlke/lab/flights/
                └── controller/             # MockMvc integration tests
```

## Architecture

### Layered architecture

```
HTTP Request
    │
    ▼
Controller  (com.zuhlke.lab.flights.controller)
    │         validates input, maps HTTP ↔ domain
    ▼
Service     (com.zuhlke.lab.flights.service)
    │         business logic
    ▼
Repository  (com.zuhlke.lab.flights.repository)
    │         Spring Data JDBC – ListCrudRepository<Flight, Long>
    ▼
H2 In-Memory Database
```

### Domain model

`Flight` (`src/main/java/com/zuhlke/lab/flights/repository/Flight.java`) is a Java `record` mapped to the `flights` table via Spring Data JDBC:

| Field           | Type            | Description                        |
|-----------------|-----------------|------------------------------------|
| `id`            | `Long`          | Primary key                        |
| `flightNumber`  | `String`        | IATA flight number (e.g. `LX100`)  |
| `airline`       | `String`        | Airline code (e.g. `SWISS`)        |
| `scheduledTime` | `LocalDateTime` | Planned departure/arrival time     |
| `actualTime`    | `LocalDateTime` | Actual departure/arrival time      |
| `status`        | `String`        | `ON_TIME`, `DELAYED`, `CANCELLED`  |
| `delayMinutes`  | `Integer`       | Delay in minutes (null if on time) |
| `createdAt`     | `LocalDateTime` | Record creation timestamp          |

## Running the application

```bash
task run   # starts on port 8080
```

See `README.md` for the full quick-start guide.
