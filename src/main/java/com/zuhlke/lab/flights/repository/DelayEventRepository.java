package com.zuhlke.lab.flights.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.ListCrudRepository;

public interface DelayEventRepository extends ListCrudRepository<DelayEvent, Long> {

    List<DelayEvent> findByFlightIdOrderByRecordedAtAsc(Long flightId);

    List<DelayEvent> findByFlightIdIn(Collection<Long> flightIds);

    // Two events can share a timestamp: the one recorded last, the higher id, wins.
    Optional<DelayEvent> findFirstByFlightIdOrderByRecordedAtDescIdDesc(Long flightId);
}
