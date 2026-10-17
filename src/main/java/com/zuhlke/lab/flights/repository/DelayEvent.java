package com.zuhlke.lab.flights.repository;

import java.time.LocalDateTime;
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
}
