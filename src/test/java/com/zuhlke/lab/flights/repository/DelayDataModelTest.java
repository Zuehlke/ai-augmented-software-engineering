package com.zuhlke.lab.flights.repository;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
class DelayDataModelTest {

    @Autowired
    private AirlineRepository airlines;

    @Autowired
    private FlightRepository flights;

    @Autowired
    private DelayEventRepository delayEvents;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void findById_storedAirline_returnsItsName() {
        assertThat(airlines.findById("LX")).hasValueSatisfying(airline ->
                assertThat(airline.name()).isEqualTo("SWISS"));
    }

    @Test
    void findByAirlineCode_airlineWithFlights_returnsAllItsFlights() {
        assertThat(flights.findByAirlineCode("LX"))
                .extracting(Flight::flightNumber)
                .containsExactlyInAnyOrder("LX100", "LX318", "LX1612");
    }

    @Test
    void count_seededData_keepsEveryOriginalRecord() {
        assertThat(flights.count()).isEqualTo(23);
        assertThat(delayEvents.count()).isEqualTo(26);
    }

    @Test
    void findByFlightIdOrderByRecordedAtAsc_flightWithTwoEvents_returnsThemOldestFirst() {
        assertThat(delayEvents.findByFlightIdOrderByRecordedAtAsc(2L))
                .extracting(DelayEvent::status)
                .containsExactly("ON_TIME", "DELAYED");
    }

    @Test
    void findFirstByFlightId_flightWithTwoEvents_returnsTheLatest() {
        assertThat(delayEvents.findFirstByFlightIdOrderByRecordedAtDescIdDesc(2L))
                .hasValueSatisfying(event -> {
                    assertThat(event.status()).isEqualTo("DELAYED");
                    assertThat(event.delayMinutes()).isEqualTo(40);
                });
    }

    @Test
    @Transactional
    void findFirstByFlightId_eventsShareATimestamp_returnsTheHigherId() {
        jdbc.update("""
                INSERT INTO "delay_events" ("ID", "FLIGHT_ID", "STATUS", "DELAY_MINUTES", "RECORDED_AT")
                SELECT 100, "FLIGHT_ID", 'CANCELLED', NULL, "RECORDED_AT" FROM "delay_events" WHERE "ID" = 1
                """);

        assertThat(delayEvents.findFirstByFlightIdOrderByRecordedAtDescIdDesc(1L))
                .hasValueSatisfying(event -> assertThat(event.status()).isEqualTo("CANCELLED"));
    }
}
