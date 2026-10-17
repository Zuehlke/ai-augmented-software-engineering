package com.zuhlke.lab.flights.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zuhlke.lab.flights.repository.Airline;
import com.zuhlke.lab.flights.repository.AirlineRepository;
import com.zuhlke.lab.flights.repository.DelayEvent;
import com.zuhlke.lab.flights.repository.DelayEventRepository;
import com.zuhlke.lab.flights.repository.Flight;
import com.zuhlke.lab.flights.repository.FlightRepository;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(DashboardController.class)
class DashboardControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AirlineRepository airlineRepository;

    @MockitoBean
    private FlightRepository flightRepository;

    @MockitoBean
    private DelayEventRepository delayEventRepository;

    @Test
    void airlineOverview_knownAirline_returnsNameAndFlightsThatAreNotCancelled() throws Exception {
        givenAirline("LX", "SWISS");
        givenFlight(1L, "LX100", "LX");
        givenFlight(2L, "LX318", "LX");
        givenFlight(3L, "LX1612", "LX");
        givenLatestEvent(1L, "ON_TIME", null);
        givenLatestEvent(2L, "DELAYED", 40);
        givenLatestEvent(3L, "CANCELLED", null);

        mockMvc.perform(get("/airlines/{code}/overview", "LX"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("LX"))
                .andExpect(jsonPath("$.name").value("SWISS"))
                .andExpect(jsonPath("$.activeOrScheduledFlights").value(2));
    }

    @Test
    void airlineOverview_codeInLowerCase_looksUpTheUpperCaseCode() throws Exception {
        givenAirline("LX", "SWISS");

        mockMvc.perform(get("/airlines/{code}/overview", "lx"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("SWISS"));

        verify(airlineRepository).findById("LX");
    }

    @Test
    void airlineOverview_flightWithoutDelayEvents_countsAsActiveOrScheduled() throws Exception {
        givenAirline("LX", "SWISS");
        givenFlight(1L, "LX100", "LX");

        mockMvc.perform(get("/airlines/{code}/overview", "LX"))
                .andExpect(jsonPath("$.activeOrScheduledFlights").value(1));
    }

    @Test
    void airlineOverview_airlineWithoutFlights_countsZero() throws Exception {
        givenAirline("LX", "SWISS");

        mockMvc.perform(get("/airlines/{code}/overview", "LX"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeOrScheduledFlights").value(0));
    }

    @Test
    void airlineOverview_unknownAirline_returnsNotFound() throws Exception {
        mockMvc.perform(get("/airlines/{code}/overview", "ZZ"))
                .andExpect(status().isNotFound());
    }

    @Test
    void flightStatus_delayedFlight_returnsLatestStatusAndDelay() throws Exception {
        givenFlight(2L, "BA456", "BA");
        givenLatestEvent(2L, "DELAYED", 40);

        mockMvc.perform(get("/flights/{flightNumber}/status", "BA456"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flightNumber").value("BA456"))
                .andExpect(jsonPath("$.status").value("DELAYED"))
                .andExpect(jsonPath("$.delayMinutes").value(40));
    }

    @ParameterizedTest
    @CsvSource({"ON_TIME", "CANCELLED"})
    void flightStatus_flightWithoutDelay_returnsStatusAndNoDelayMinutes(String eventStatus) throws Exception {
        givenFlight(3L, "KL301", "KL");
        givenLatestEvent(3L, eventStatus, null);

        mockMvc.perform(get("/flights/{flightNumber}/status", "KL301"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(eventStatus))
                .andExpect(jsonPath("$.delayMinutes").doesNotExist());
    }

    @Test
    void flightStatus_flightWithoutDelayEvents_returnsOnTime() throws Exception {
        givenFlight(4L, "KL302", "KL");

        mockMvc.perform(get("/flights/{flightNumber}/status", "KL302"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ON_TIME"))
                .andExpect(jsonPath("$.delayMinutes").doesNotExist());
    }

    @Test
    void flightStatus_flightNumberInLowerCase_looksUpTheUpperCaseNumber() throws Exception {
        givenFlight(2L, "BA456", "BA");

        mockMvc.perform(get("/flights/{flightNumber}/status", "ba456"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flightNumber").value("BA456"));

        verify(flightRepository).findByFlightNumber("BA456");
    }

    @Test
    void flightStatus_unknownFlight_returnsNotFound() throws Exception {
        mockMvc.perform(get("/flights/{flightNumber}/status", "XX999"))
                .andExpect(status().isNotFound());
    }

    private void givenAirline(String code, String name) {
        when(airlineRepository.findById(code)).thenReturn(Optional.of(new Airline(code, name)));
    }

    private void givenFlight(long id, String flightNumber, String airlineCode) {
        Flight flight = new Flight(id, flightNumber, airlineCode, "ZRH", "LHR", null);
        when(flightRepository.findByFlightNumber(flightNumber)).thenReturn(Optional.of(flight));
        List<Flight> flightsOfAirline = new ArrayList<>(flightRepository.findByAirlineCode(airlineCode));
        flightsOfAirline.add(flight);
        when(flightRepository.findByAirlineCode(airlineCode)).thenReturn(flightsOfAirline);
    }

    private void givenLatestEvent(long flightId, String status, Integer delayMinutes) {
        DelayEvent event = new DelayEvent(flightId * 10, flightId, status, delayMinutes, null,
                LocalDateTime.of(2026, 1, 1, 12, 0));
        when(delayEventRepository.findFirstByFlightIdOrderByRecordedAtDescIdDesc(flightId))
                .thenReturn(Optional.of(event));
    }
}
