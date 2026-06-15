package com.zuhlke.lab.flights.repository;

import java.time.LocalDateTime;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;

@Table("flights")
public record Flight(
        @Id Long id,
        String flightNumber,
        String airline,
        LocalDateTime scheduledTime,
        LocalDateTime actualTime,
        String status,
        Integer delayMinutes,
        LocalDateTime createdAt
) {
}
