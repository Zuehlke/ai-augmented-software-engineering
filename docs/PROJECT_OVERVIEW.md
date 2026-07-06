# Project Overview

## Purpose

`flight-api` is a Spring Boot REST API for managing and querying flight information.

---

## Environment

| Tool    | Version | Managed by              |
|---------|---------|-------------------------|
| Java    | 25      | [`mise.toml`](../mise.toml) |
| Maven   | 3       | [`mise.toml`](../mise.toml) |
| Node    | 24      | [`mise.toml`](../mise.toml) |

Tool versions can be installed automatically via [mise](https://mise.jdx.dev/):

```bash
mise install
```

---

## Project Structure

```
lab/
├── mise.toml                               # Tool versions managed by mise
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

---

## Main Architectural Concepts

### Layered Architecture

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

### Domain Model

`Flight` ([`src/main/java/com/zuhlke/lab/flights/repository/Flight.java`](../src/main/java/com/zuhlke/lab/flights/repository/Flight.java)) is a Java `record` mapped to the `flights` table via Spring Data JDBC:

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

### Database

- **Engine:** H2 in-memory (`jdbc:h2:mem:flightsdb`)
- **Schema:** initialised from [`schema.sql`](../src/main/resources/schema.sql) on every startup
- **Seed data:** 20 flights loaded from [`data.sql`](../src/main/resources/data.sql)
- Data is **not persisted** between restarts

---

## Integrations

| Integration          | Details                                                                                       |
|----------------------|-----------------------------------------------------------------------------------------------|
| **Swagger UI**       | Auto-generated via SpringDoc OpenAPI 3.0.0; available at http://localhost:8080/swagger-ui/index.html |
| **Spring Actuator**  | Health endpoint exposed at `/actuator/health`; shown in Swagger UI (`springdoc.show-actuator: true`) |
| **H2 Console**       | Not explicitly configured; accessible via the embedded H2 driver during development           |

---

## Running the Application

```bash
# Start on port 8080
mvn spring-boot:run
```

See [`README.md`](../README.md) for the full quick-start guide.