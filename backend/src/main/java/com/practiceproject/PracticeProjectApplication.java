package com.practiceproject;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

// We authenticate users ourselves (AuthService), so Spring's default in-memory user is switched off.
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
@ConfigurationPropertiesScan
// Repositories are grouped as nested interfaces per feature (e.g. CatalogRepositories.MovieRepository).
@EnableJpaRepositories(considerNestedRepositories = true)
public class PracticeProjectApplication {

    public static void main(String[] args) {
        SpringApplication.run(PracticeProjectApplication.class, args);
    }
}
