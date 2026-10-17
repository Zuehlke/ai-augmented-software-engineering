package com.zuhlke.lab.flights.repository;

import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;

@Table("airlines")
public record Airline(
        @Id String code,
        String name
) {
}
