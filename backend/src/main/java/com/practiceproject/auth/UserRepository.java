package com.practiceproject.auth;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface UserRepository extends JpaRepository<User, Long> {

    // Matches the lower(email) unique index from V1, so this lookup uses the index.
    @Query("select u from User u where lower(u.email) = lower(:email)")
    Optional<User> findByEmailIgnoreCase(String email);

    @Query(value = "select cinema_id from manager_cinemas where user_id = :userId order by cinema_id", nativeQuery = true)
    List<Long> findManagedCinemaIds(Long userId);

    @Modifying
    @Query(value = "delete from manager_cinemas where user_id = :userId", nativeQuery = true)
    void clearManagedCinemas(Long userId);

    @Modifying
    @Query(value = "insert into manager_cinemas (user_id, cinema_id) values (:userId, :cinemaId) on conflict do nothing", nativeQuery = true)
    void addManagedCinema(Long userId, Long cinemaId);
}
