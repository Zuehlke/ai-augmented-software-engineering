package com.zuhlke.lab.flights.acceptance;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

// The evals' hidden acceptance tests for the task airline-delay-summary. The agents never see this file.
@SpringBootTest
@AutoConfigureMockMvc
class AirlineDelaySummaryAcceptanceTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void theCountsAndTheAverageDelay() throws Exception {
        // LX100 delayed 15, LX318 on time first and then delayed 10, LX1612 on time
        mockMvc.perform(get("/airlines/lx/delay-summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("LX"))
                .andExpect(jsonPath("$.name").value("SWISS"))
                .andExpect(jsonPath("$.flights").value(3))
                .andExpect(jsonPath("$.onTime").value(1))
                .andExpect(jsonPath("$.delayed").value(2))
                .andExpect(jsonPath("$.cancelled").value(0))
                .andExpect(jsonPath("$.averageDelayMinutes").value(12.5));
    }

    @Test
    void cancelledByTheLatestEvent() throws Exception {
        // LH200 delayed 30, LH400 on time first, then cancelled
        mockMvc.perform(get("/airlines/LH/delay-summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flights").value(2))
                .andExpect(jsonPath("$.onTime").value(0))
                .andExpect(jsonPath("$.delayed").value(1))
                .andExpect(jsonPath("$.cancelled").value(1))
                .andExpect(jsonPath("$.averageDelayMinutes").value(30.0));
    }

    @Test
    void noAverageWithoutDelayedFlights() throws Exception {
        // KL301 is on time
        mockMvc.perform(get("/airlines/KL/delay-summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.onTime").value(1))
                .andExpect(jsonPath("$.averageDelayMinutes").doesNotExist());
    }

    @Test
    void anUnknownAirlineIsNotFound() throws Exception {
        mockMvc.perform(get("/airlines/ZZ/delay-summary"))
                .andExpect(status().isNotFound());
    }
}
