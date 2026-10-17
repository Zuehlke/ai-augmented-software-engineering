package com.zuhlke.lab.flights.acceptance;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

// The evals' hidden acceptance tests for the task status-filter. The agents never see this file.
@SpringBootTest
@AutoConfigureMockMvc
class StatusFilterAcceptanceTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void onlyTheCancelledFlightsByTheirLatestEvent() throws Exception {
        // LH400 was on time first, its latest event cancels it
        mockMvc.perform(get("/delays").param("status", "cancelled"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].flightNumber").value(containsInAnyOrder("AF789", "AZ510", "ET728", "LH400")))
                .andExpect(jsonPath("$[*].status").value(everyItem(is("CANCELLED"))));
    }

    @Test
    void theStatusInAnyCase() throws Exception {
        mockMvc.perform(get("/delays").param("status", "DELAYED"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(10));
        mockMvc.perform(get("/delays").param("status", "On_Time"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(9));
    }

    @Test
    void togetherWithTheAirlineFilter() throws Exception {
        mockMvc.perform(get("/delays").param("airline_code", "LX").param("status", "delayed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].flightNumber").value(containsInAnyOrder("LX100", "LX318")));
    }

    @Test
    void anEmptyListWhenNoFlightHasThatStatus() throws Exception {
        mockMvc.perform(get("/delays").param("airline_code", "KL").param("status", "cancelled"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").value(empty()));
    }

    @Test
    void anyOtherStatusIsABadRequest() throws Exception {
        mockMvc.perform(get("/delays").param("status", "boarding"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void withoutStatusEveryFlightAsBefore() throws Exception {
        mockMvc.perform(get("/delays"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(23));
    }
}
