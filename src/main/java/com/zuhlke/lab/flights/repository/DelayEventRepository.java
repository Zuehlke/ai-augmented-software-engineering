package com.zuhlke.lab.flights.repository;

import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.ListCrudRepository;

public interface DelayEventRepository extends ListCrudRepository<DelayEvent, Long> {

    List<DelayEvent> findByFlightIdOrderByRecordedAtAsc(Long flightId);

    Optional<DelayEvent> findFirstByFlightIdOrderByRecordedAtDesc(Long flightId);
}
