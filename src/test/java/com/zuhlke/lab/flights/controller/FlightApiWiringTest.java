package com.zuhlke.lab.flights.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

/** Integration tests: controllers, repositories and the seeded database wired together. */
@SpringBootTest
@AutoConfigureMockMvc
class FlightApiWiringTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void delays_noAirlineCode_returnsEverySeededFlight() throws Exception {
        mockMvc.perform(get("/delays"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(23));
    }

    @Test
    void delays_airlineCode_returnsTheSeededFlightsWithTheirLatestEvent() throws Exception {
        mockMvc.perform(get("/delays").param("airline_code", "LH"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].flightNumber").value("LH200"))
                .andExpect(jsonPath("$[0].airline").value("Lufthansa"))
                .andExpect(jsonPath("$[0].status").value("DELAYED"))
                .andExpect(jsonPath("$[0].delayMinutes").value(30));
    }

    @Test
    void airlineOverview_seededAirline_countsFlightsThatAreNotCancelled() throws Exception {
        mockMvc.perform(get("/airlines/{code}/overview", "LH"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeOrScheduledFlights").value(1));
    }

    @Test
    void flightStatus_flightWithSeveralEvents_returnsTheLatestOne() throws Exception {
        mockMvc.perform(get("/flights/{flightNumber}/status", "BA456"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DELAYED"))
                .andExpect(jsonPath("$.delayMinutes").value(40));
    }
}
