package com.zuhlke.lab.flights.repository;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class DelayDataModelTest {

    @Autowired
    private AirlineRepository airlines;

    @Autowired
    private FlightRepository flights;

    @Autowired
    private DelayEventRepository delayEvents;

    @Test
    void shouldStoreAirlinesIndependentlyOfDelayRecords() {
        assertThat(airlines.findById("LX")).hasValueSatisfying(airline ->
                assertThat(airline.name()).isEqualTo("SWISS"));
    }

    @Test
    void shouldFindAllFlightsOfAnAirline() {
        assertThat(flights.findByAirlineCode("LX"))
                .extracting(Flight::flightNumber)
                .containsExactlyInAnyOrder("LX100", "LX318", "LX1612");
    }

    @Test
    void shouldKeepEveryOriginalDelayRecord() {
        assertThat(flights.count()).isEqualTo(23);
        assertThat(delayEvents.count()).isEqualTo(26);
    }

    @Test
    void shouldSupportMultipleDelayEventsPerFlight() {
        assertThat(delayEvents.findByFlightIdOrderByRecordedAtAsc(2L))
                .extracting(DelayEvent::status)
                .containsExactly("ON_TIME", "DELAYED");
    }

    @Test
    void shouldReturnTheLatestDelayEventOfAFlight() {
        assertThat(delayEvents.findFirstByFlightIdOrderByRecordedAtDesc(2L))
                .hasValueSatisfying(event -> {
                    assertThat(event.status()).isEqualTo("DELAYED");
                    assertThat(event.delayMinutes()).isEqualTo(40);
                });
    }
}
