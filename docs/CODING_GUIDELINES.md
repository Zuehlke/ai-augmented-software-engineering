# Coding Guidelines

---

## Package Structure

New code should follow the existing layer layout under `com.zuhlke.lab.flights`:

```
controller/   ← HTTP layer (REST controllers, request/response mapping)
service/      ← Business logic
repository/   ← Data access (Spring Data JDBC repositories, domain records)
```

---

## Command Executions

All commands assume tools are available via mise (see [`mise.toml`](../mise.toml)):

```bash
# Install required tool versions
mise install

# Run the application
mvn spring-boot:run

# Run all tests
mvn test

# Build (skip tests)
mvn package -DskipTests

# Build and run tests
mvn verify
```

---

## Testing

- Framework: **JUnit 5** + **Spring Boot Test** (`@SpringBootTest`)
- HTTP layer: **MockMvc** (`@AutoConfigureMockMvc`)
- Test class location mirrors the main source tree under `src/test/java/`
- Naming: `<Subject>Test.java`

---

## Database & SQL

- Schema DDL lives in [`src/main/resources/schema.sql`](../src/main/resources/schema.sql) — recreated on every startup (`spring.sql.init.mode: always`)
- Seed data lives in [`src/main/resources/data.sql`](../src/main/resources/data.sql)
- Column names in SQL use `UPPER_SNAKE_CASE` quoted identifiers; Java field names use `camelCase` (mapped automatically by Spring Data JDBC)

---

## Security Practices

- Do **not** commit credentials, tokens, or environment-specific configuration to source control
- H2 is for **development and testing only** — replace with a persistent, secured database for any production deployment