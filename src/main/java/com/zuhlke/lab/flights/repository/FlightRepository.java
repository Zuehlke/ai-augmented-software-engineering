package com.zuhlke.lab.flights.repository;

import java.util.List;
import org.springframework.data.repository.ListCrudRepository;

public interface FlightRepository extends ListCrudRepository<Flight, Long> {

    List<Flight> findByAirlineCode(String airlineCode);
}
