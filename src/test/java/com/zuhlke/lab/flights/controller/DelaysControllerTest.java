package com.zuhlke.lab.flights.controller;

import static org.mockito.ArgumentMatchers.anyCollection;
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
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(DelaysController.class)
class DelaysControllerTest {

    private static final Flight LH200 = new Flight(1L, "LH200", "LH", "FRA", "ZRH", null);
    private static final Flight LH400 = new Flight(2L, "LH400", "LH", "FRA", "LHR", null);
    private static final Flight LX100 = new Flight(3L, "LX100", "LX", "ZRH", "LHR", null);

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private FlightRepository flightRepository;

    @MockitoBean
    private AirlineRepository airlineRepository;

    @MockitoBean
    private DelayEventRepository delayEventRepository;

    @BeforeEach
    void givenAirlines() {
        when(airlineRepository.findAll()).thenReturn(List.of(
                new Airline("LH", "Lufthansa"), new Airline("LX", "SWISS")));
    }

    @Test
    void delays_noAirlineCode_returnsEveryFlight() throws Exception {
        when(flightRepository.findAll()).thenReturn(List.of(LH200, LH400, LX100));

        mockMvc.perform(get("/delays"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3));
    }

    @Test
    void delays_blankAirlineCode_returnsEveryFlight() throws Exception {
        when(flightRepository.findAll()).thenReturn(List.of(LH200, LX100));

        mockMvc.perform(get("/delays").param("airline_code", " "))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void delays_airlineCode_returnsOnlyThatAirlinesFlightsWithLatestStatusAndDelay() throws Exception {
        when(flightRepository.findByAirlineCode("LH")).thenReturn(List.of(LH200, LH400));
        givenEvents(event(1L, 1L, "DELAYED", 30, 10), event(2L, 2L, "CANCELLED", null, 10));

        mockMvc.perform(get("/delays").param("airline_code", "LH"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].flightNumber").value("LH200"))
                .andExpect(jsonPath("$[0].airline").value("Lufthansa"))
                .andExpect(jsonPath("$[0].status").value("DELAYED"))
                .andExpect(jsonPath("$[0].delayMinutes").value(30))
                .andExpect(jsonPath("$[1].status").value("CANCELLED"))
                .andExpect(jsonPath("$[1].delayMinutes").doesNotExist());
    }

    @Test
    void delays_airlineCodeInLowerCase_looksUpTheUpperCaseCode() throws Exception {
        when(flightRepository.findByAirlineCode("LH")).thenReturn(List.of(LH200));

        mockMvc.perform(get("/delays").param("airline_code", "lh"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        verify(flightRepository).findByAirlineCode("LH");
    }

    @Test
    void delays_airlineCodeWithoutFlights_returnsNotFound() throws Exception {
        mockMvc.perform(get("/delays").param("airline_code", "ZZ"))
                .andExpect(status().isNotFound());
    }

    @Test
    void delays_flightWithoutDelayEvents_isOnTimeWithoutDelay() throws Exception {
        when(flightRepository.findAll()).thenReturn(List.of(LX100));

        mockMvc.perform(get("/delays"))
                .andExpect(jsonPath("$[0].status").value("ON_TIME"))
                .andExpect(jsonPath("$[0].delayMinutes").doesNotExist());
    }

    @Test
    void delays_flightWithSeveralEvents_usesTheLatestRecordedOne() throws Exception {
        when(flightRepository.findAll()).thenReturn(List.of(LH200));
        givenEvents(event(11L, 1L, "ON_TIME", null, 8), event(10L, 1L, "DELAYED", 40, 9));

        mockMvc.perform(get("/delays"))
                .andExpect(jsonPath("$[0].status").value("DELAYED"))
                .andExpect(jsonPath("$[0].delayMinutes").value(40));
    }

    @Test
    void delays_twoEventsRecordedAtTheSameTime_usesTheOneWithTheHigherId() throws Exception {
        when(flightRepository.findAll()).thenReturn(List.of(LH200));
        givenEvents(event(10L, 1L, "DELAYED", 40, 9), event(11L, 1L, "CANCELLED", null, 9));

        mockMvc.perform(get("/delays"))
                .andExpect(jsonPath("$[0].status").value("CANCELLED"));
    }

    private void givenEvents(DelayEvent... events) {
        when(delayEventRepository.findByFlightIdIn(anyCollection())).thenReturn(List.of(events));
    }

    private static DelayEvent event(long id, long flightId, String status, Integer delayMinutes, int hour) {
        return new DelayEvent(id, flightId, status, delayMinutes, null, LocalDateTime.of(2026, 1, 1, hour, 0));
    }
}
