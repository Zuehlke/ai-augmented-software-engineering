package com.zuhlke.lab.flights.controller;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class DashboardPageTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void shouldServeTheDashboardPage() throws Exception {
        mockMvc.perform(get("/dashboard.html"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("Flight Delays Dashboard")));
    }
}
