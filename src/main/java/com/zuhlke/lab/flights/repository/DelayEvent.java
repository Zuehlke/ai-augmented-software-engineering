package com.zuhlke.lab.flights.repository;

import java.time.LocalDateTime;
import java.util.Comparator;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;

@Table("delay_events")
public record DelayEvent(
        @Id Long id,
        Long flightId,
        String status,
        Integer delayMinutes,
        LocalDateTime actualTime,
        LocalDateTime recordedAt
) {

    /** Orders events from oldest to latest, the same way the repository picks the latest one. */
    public static final Comparator<DelayEvent> RECORDED_ORDER =
            Comparator.comparing(DelayEvent::recordedAt).thenComparing(DelayEvent::id);
}
