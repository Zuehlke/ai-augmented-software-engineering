package com.zuhlke.lab.flights.controller;

import com.zuhlke.lab.flights.repository.Airline;
import com.zuhlke.lab.flights.repository.AirlineRepository;
import com.zuhlke.lab.flights.repository.DelayEvent;
import com.zuhlke.lab.flights.repository.DelayEventRepository;
import com.zuhlke.lab.flights.repository.Flight;
import com.zuhlke.lab.flights.repository.FlightRepository;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DelaysController {

    private final FlightRepository flightRepository;
    private final AirlineRepository airlineRepository;
    private final DelayEventRepository delayEventRepository;

    public DelaysController(FlightRepository flightRepository, AirlineRepository airlineRepository,
            DelayEventRepository delayEventRepository) {
        this.flightRepository = flightRepository;
        this.airlineRepository = airlineRepository;
        this.delayEventRepository = delayEventRepository;
    }

    @GetMapping("/delays")
    public ResponseEntity<List<DelayView>> delays(
            @RequestParam(name = "airline_code", required = false) String airlineCode) {
        List<Flight> flights = airlineCode == null || airlineCode.isBlank()
                ? flightRepository.findAll()
                : flightRepository.findByAirlineCode(airlineCode.toUpperCase(Locale.ROOT));

        if (flights.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        Map<String, String> airlineNames = airlineRepository.findAll().stream()
                .collect(Collectors.toMap(Airline::code, Airline::name));
        return ResponseEntity.ok(flights.stream()
                .map(flight -> DelayView.from(flight, airlineNames.get(flight.airlineCode()),
                        delayEventRepository.findFirstByFlightIdOrderByRecordedAtDesc(flight.id()).orElse(null)))
                .toList());
    }

    private record DelayView(String flightNumber, String airline, String status, Integer delayMinutes) {
        static DelayView from(Flight flight, String airline, DelayEvent latest) {
            return new DelayView(flight.flightNumber(), airline,
                    latest == null ? null : latest.status(),
                    latest == null ? null : latest.delayMinutes());
        }
    }
}
