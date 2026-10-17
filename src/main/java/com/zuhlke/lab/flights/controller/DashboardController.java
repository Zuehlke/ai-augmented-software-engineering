package com.zuhlke.lab.flights.controller;

import com.zuhlke.lab.flights.repository.Airline;
import com.zuhlke.lab.flights.repository.AirlineRepository;
import com.zuhlke.lab.flights.repository.DelayEvent;
import com.zuhlke.lab.flights.repository.DelayEventRepository;
import com.zuhlke.lab.flights.repository.Flight;
import com.zuhlke.lab.flights.repository.FlightRepository;
import java.util.Locale;
import java.util.Optional;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DashboardController {

    private final AirlineRepository airlineRepository;
    private final FlightRepository flightRepository;
    private final DelayEventRepository delayEventRepository;

    public DashboardController(AirlineRepository airlineRepository, FlightRepository flightRepository,
            DelayEventRepository delayEventRepository) {
        this.airlineRepository = airlineRepository;
        this.flightRepository = flightRepository;
        this.delayEventRepository = delayEventRepository;
    }

    @GetMapping("/airlines/{code}/overview")
    public ResponseEntity<AirlineOverview> airlineOverview(@PathVariable String code) {
        Optional<Airline> airline = airlineRepository.findById(code.toUpperCase(Locale.ROOT));
        if (airline.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        long activeOrScheduled = flightRepository.findByAirlineCode(airline.get().code()).stream()
                .map(flight -> latestEvent(flight).map(DelayEvent::status).orElse("ON_TIME"))
                .filter(status -> !status.equals("CANCELLED"))
                .count();
        return ResponseEntity.ok(new AirlineOverview(airline.get().code(), airline.get().name(), activeOrScheduled));
    }

    @GetMapping("/flights/{flightNumber}/status")
    public ResponseEntity<FlightStatus> flightStatus(@PathVariable String flightNumber) {
        Optional<Flight> flight = flightRepository.findByFlightNumber(flightNumber.toUpperCase(Locale.ROOT));
        if (flight.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        Optional<DelayEvent> latest = latestEvent(flight.get());
        return ResponseEntity.ok(new FlightStatus(
                flight.get().flightNumber(),
                latest.map(DelayEvent::status).orElse("ON_TIME"),
                latest.map(DelayEvent::delayMinutes).orElse(null)));
    }

    private Optional<DelayEvent> latestEvent(Flight flight) {
        return delayEventRepository.findFirstByFlightIdOrderByRecordedAtDescIdDesc(flight.id());
    }

    public record AirlineOverview(String code, String name, long activeOrScheduledFlights) {
    }

    public record FlightStatus(String flightNumber, String status, Integer delayMinutes) {
    }
}
