package com.practiceproject.booking;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Live seat-map updates.
 *
 * Writers call {@code pg_notify('seat_events', showtimeId)} inside their transaction
 * (SeatHoldRepository.notifySeatsChanged). This class keeps ONE dedicated connection that
 * runs {@code LISTEN seat_events}, so every app instance hears every change, whichever
 * instance made it. It then pushes a Server-Sent Event to the browsers watching that show,
 * and they refetch the seat map.
 */
@Component
public class SeatEvents {

    private static final Logger log = LoggerFactory.getLogger(SeatEvents.class);
    private static final long EMITTER_TIMEOUT_MS = 30 * 60 * 1000L;
    private static final int MAX_SUBSCRIBERS_PER_SHOW = 2000;

    private final Map<Long, Set<SseEmitter>> subscribers = new ConcurrentHashMap<>();
    private final DataSourceProperties dataSource;
    private volatile boolean running = true;
    private Thread listener;

    public SeatEvents(DataSourceProperties dataSource) {
        this.dataSource = dataSource;
    }

    public SseEmitter subscribe(Long showtimeId) {
        Set<SseEmitter> set = subscribers.computeIfAbsent(showtimeId, k -> new CopyOnWriteArraySet<>());
        var emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        if (set.size() >= MAX_SUBSCRIBERS_PER_SHOW) {
            emitter.complete();
            return emitter;
        }
        set.add(emitter);
        Runnable remove = () -> set.remove(emitter);
        emitter.onCompletion(remove);
        emitter.onTimeout(remove);
        emitter.onError(e -> remove.run());
        try {
            emitter.send(SseEmitter.event().comment("connected"));
        } catch (IOException e) {
            remove.run();
        }
        return emitter;
    }

    void broadcast(Long showtimeId) {
        Set<SseEmitter> set = subscribers.get(showtimeId);
        if (set == null) {
            return;
        }
        for (SseEmitter emitter : set) {
            try {
                emitter.send(SseEmitter.event().name("seats-changed").data(Map.of("showtimeId", showtimeId), MediaType.APPLICATION_JSON));
            } catch (IOException | IllegalStateException e) {
                set.remove(emitter);
            }
        }
    }

    /** Proxies and browsers drop idle connections; a comment line every 25s keeps them open. */
    @Scheduled(fixedRate = 25_000)
    void heartbeat() {
        subscribers.forEach((id, set) -> {
            for (SseEmitter emitter : set) {
                try {
                    emitter.send(SseEmitter.event().comment("ping"));
                } catch (IOException | IllegalStateException e) {
                    set.remove(emitter);
                }
            }
        });
        subscribers.entrySet().removeIf(e -> e.getValue().isEmpty());
    }

    @EventListener(ApplicationReadyEvent.class)
    public void startListening() {
        listener = Thread.ofVirtual().name("seat-events-listener").start(this::listenLoop);
    }

    private void listenLoop() {
        while (running) {
            try (Connection conn = DriverManager.getConnection(dataSource.getUrl(), dataSource.getUsername(), dataSource.getPassword())) {
                try (Statement st = conn.createStatement()) {
                    st.execute("LISTEN seat_events");
                }
                PGConnection pg = conn.unwrap(PGConnection.class);
                log.info("Listening for seat_events notifications");
                while (running) {
                    PGNotification[] notes = pg.getNotifications(5_000);
                    if (notes != null) {
                        for (PGNotification n : notes) {
                            try {
                                broadcast(Long.parseLong(n.getParameter()));
                            } catch (NumberFormatException ignored) {
                                // not ours
                            }
                        }
                    }
                }
            } catch (Exception e) {
                if (running) {
                    log.warn("seat_events listener lost its connection, retrying in 5s: {}", e.getMessage());
                    try {
                        Thread.sleep(5_000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            }
        }
    }

    @PreDestroy
    void stop() {
        running = false;
        if (listener != null) {
            listener.interrupt();
        }
        subscribers.values().forEach(set -> set.forEach(SseEmitter::complete));
    }
}
