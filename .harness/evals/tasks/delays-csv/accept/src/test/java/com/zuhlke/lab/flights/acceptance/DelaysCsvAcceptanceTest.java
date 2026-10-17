package com.zuhlke.lab.flights.acceptance;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

// The evals' hidden acceptance tests for the task delays-csv. The agents never see this file.
@SpringBootTest
@AutoConfigureMockMvc
class DelaysCsvAcceptanceTest {

    @Autowired
    private MockMvc mockMvc;

    private List<String> rows(String body) {
        return body.lines().filter(line -> !line.isBlank()).toList();
    }

    @Test
    void everyFlightAsACsvFile() throws Exception {
        String body = mockMvc.perform(get("/delays.csv"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/csv"))
                .andExpect(header().string("Content-Disposition", containsString("delays.csv")))
                .andReturn().getResponse().getContentAsString();
        List<String> rows = rows(body);
        assertThat(rows.get(0)).isEqualTo("flight_number,airline,status,delay_minutes");
        assertThat(rows).hasSize(24);
        assertThat(rows).contains("BA456,British Airways,DELAYED,40", "KL301,KLM,ON_TIME,");
    }

    @Test
    void onlyTheAirlinesFlights() throws Exception {
        String body = mockMvc.perform(get("/delays.csv").param("airline_code", "lh"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(rows(body)).containsExactlyInAnyOrder(
                "flight_number,airline,status,delay_minutes", "LH200,Lufthansa,DELAYED,30", "LH400,Lufthansa,CANCELLED,");
    }

    @Test
    void onlyTheHeaderForAnAirlineWithoutFlights() throws Exception {
        String body = mockMvc.perform(get("/delays.csv").param("airline_code", "ZZ"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(rows(body)).containsExactly("flight_number,airline,status,delay_minutes");
    }

    @Test
    void theJsonAsBefore() throws Exception {
        mockMvc.perform(get("/delays"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(23));
    }
}
