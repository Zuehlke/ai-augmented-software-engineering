package com.zuhlke.lab.flights.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class DelaysControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void shouldReturnAllFlightsWhenNoAirlineCodeGiven() throws Exception {
        mockMvc.perform(get("/delays"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(23));
    }

    @Test
    void shouldFilterByAirlineCode() throws Exception {
        mockMvc.perform(get("/delays").param("airline_code", "LH"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].flightNumber").value("LH200"))
                .andExpect(jsonPath("$[0].airline").value("Lufthansa"))
                .andExpect(jsonPath("$[0].status").value("DELAYED"))
                .andExpect(jsonPath("$[0].delayMinutes").value(30));
    }

    @Test
    void shouldFilterCaseInsensitively() throws Exception {
        mockMvc.perform(get("/delays").param("airline_code", "lh"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void shouldReturnNotFoundForUnknownAirlineCode() throws Exception {
        mockMvc.perform(get("/delays").param("airline_code", "ZZ"))
                .andExpect(status().isNotFound());
    }
}
