package com.zuhlke.lab.flights.acceptance;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

// The evals' hidden acceptance tests for the task min-delay-filter. The agents never see this file.
@SpringBootTest
@AutoConfigureMockMvc
class MinDelayAcceptanceTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void onlyFlightsDelayedAtLeastThatLong() throws Exception {
        mockMvc.perform(get("/delays").param("min_delay", "30"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].flightNumber").value(containsInAnyOrder("BA456", "LH200", "AY151", "SQ345")))
                .andExpect(jsonPath("$[*].delayMinutes").value(everyItem(greaterThanOrEqualTo(30))));
    }

    @Test
    void togetherWithTheAirlineFilter() throws Exception {
        mockMvc.perform(get("/delays").param("airline_code", "lx").param("min_delay", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].flightNumber").value(containsInAnyOrder("LX100", "LX318")));
    }

    @Test
    void anEmptyListWhenNoFlightIsDelayedThatLong() throws Exception {
        mockMvc.perform(get("/delays").param("min_delay", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").value(empty()));
    }

    @Test
    void aNegativeMinDelayIsABadRequest() throws Exception {
        mockMvc.perform(get("/delays").param("min_delay", "-5"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aMinDelayThatIsNoNumberIsABadRequest() throws Exception {
        mockMvc.perform(get("/delays").param("min_delay", "soon"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void withoutMinDelayEveryFlightAsBefore() throws Exception {
        mockMvc.perform(get("/delays"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(23));
    }
}
