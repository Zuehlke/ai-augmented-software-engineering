package com.zuhlke.lab.flights.acceptance;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

// The evals' hidden acceptance tests for the task airport-departures. The agents never see this file.
@SpringBootTest
@AutoConfigureMockMvc
class AirportDeparturesAcceptanceTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void theDeparturesSortedByScheduledTime() throws Exception {
        // LH400 is cancelled by its latest event
        mockMvc.perform(get("/airports/FRA/departures"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].flightNumber").value(contains("LH200", "LH400")))
                .andExpect(jsonPath("$[0].status").value("DELAYED"))
                .andExpect(jsonPath("$[0].delayMinutes").value(30))
                .andExpect(jsonPath("$[1].status").value("CANCELLED"));
    }

    @Test
    void theCodeInAnyCase() throws Exception {
        // LX318 was on time first, its latest event delays it by 10 minutes
        mockMvc.perform(get("/airports/zrh/departures"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].flightNumber").value(contains("LX100", "LX318")))
                .andExpect(jsonPath("$[1].delayMinutes").value(10));
    }

    @Test
    void anEmptyListForAnAirportWithoutDepartures() throws Exception {
        mockMvc.perform(get("/airports/BER/departures"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").value(empty()));
    }

    @Test
    void aCodeThatIsNotThreeLettersIsABadRequest() throws Exception {
        mockMvc.perform(get("/airports/ZURICH/departures"))
                .andExpect(status().isBadRequest());
    }
}
