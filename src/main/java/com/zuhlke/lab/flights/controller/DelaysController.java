package com.zuhlke.lab.flights.controller;

import com.zuhlke.lab.flights.repository.Flight;
import com.zuhlke.lab.flights.repository.FlightRepository;
import java.util.List;
import java.util.Locale;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DelaysController {

    private final FlightRepository flightRepository;

    public DelaysController(FlightRepository flightRepository) {
        this.flightRepository = flightRepository;
    }

    @GetMapping("/delays")
    public ResponseEntity<List<DelayView>> delays(
            @RequestParam(name = "airline_code", required = false) String airlineCode) {
        List<Flight> flights = flightRepository.findAll();

        if (airlineCode == null || airlineCode.isBlank()) {
            return ResponseEntity.ok(flights.stream().map(DelayView::from).toList());
        }

        String code = airlineCode.toUpperCase(Locale.ROOT);
        List<Flight> matching = flights.stream()
                .filter(flight -> flight.flightNumber().toUpperCase(Locale.ROOT).startsWith(code))
                .toList();

        if (matching.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(matching.stream().map(DelayView::from).toList());
    }

    private record DelayView(String flightNumber, String airline, String status, Integer delayMinutes) {
        static DelayView from(Flight flight) {
            return new DelayView(flight.flightNumber(), flight.airline(), flight.status(), flight.delayMinutes());
        }
    }
}
