package local.editorwhatsapp;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class ScheduledTemplateStore {
    public static final String EVERY_20_MINUTES = "every20min";
    public static final String WEEKLY = "weekly";
    private static final ZoneId ZONE = ZoneId.of("America/Sao_Paulo");
    private final ObjectMapper mapper;
    private final Path file;
    private Map<String, ScheduledTemplate> schedules = new LinkedHashMap<>();

    @Autowired
    public ScheduledTemplateStore(ObjectMapper mapper) throws IOException {
        this(mapper, Path.of(System.getenv().getOrDefault("APP_DATA_DIR", "data"), "scheduled-templates.json"));
    }

    ScheduledTemplateStore(ObjectMapper mapper, Path file) throws IOException {
        this.mapper = mapper;
        this.file = file.toAbsolutePath();
        if (Files.exists(this.file)) {
            List<ScheduledTemplate> saved = mapper.readValue(this.file.toFile(), new TypeReference<>() {});
            for (ScheduledTemplate schedule : saved) schedules.put(schedule.slot(), schedule);
        }
    }

    public synchronized List<ScheduledTemplate> all() {
        return List.copyOf(schedules.values());
    }

    public synchronized ScheduledTemplate save(String slot, String to, String name, String language,
                                                List<String> bodyParameters, String weekday, String time,
                                                Instant now) throws IOException {
        ScheduledTemplate schedule = new ScheduledTemplate(slot, to, name, language, List.copyOf(bodyParameters),
                weekday, time, nextRunAt(slot, weekday, time, now));
        Map<String, ScheduledTemplate> updated = new LinkedHashMap<>(schedules);
        updated.put(slot, schedule);
        persist(updated);
        schedules = updated;
        return schedule;
    }

    public synchronized void delete(String slot) throws IOException {
        Map<String, ScheduledTemplate> updated = new LinkedHashMap<>(schedules);
        updated.remove(slot);
        persist(updated);
        schedules = updated;
    }

    public synchronized List<ScheduledTemplate> claimDue(Instant now) throws IOException {
        List<ScheduledTemplate> due = new ArrayList<>();
        Map<String, ScheduledTemplate> updated = new LinkedHashMap<>(schedules);
        for (ScheduledTemplate schedule : schedules.values()) {
            if (schedule.nextRunAt() > now.toEpochMilli()) continue;
            due.add(schedule);
            updated.put(schedule.slot(), new ScheduledTemplate(schedule.slot(), schedule.to(), schedule.name(),
                    schedule.language(), schedule.bodyParameters(), schedule.weekday(), schedule.time(),
                    nextRunAt(schedule.slot(), schedule.weekday(), schedule.time(), now)));
        }
        if (!due.isEmpty()) {
            persist(updated);
            schedules = updated;
        }
        return due;
    }

    static long nextRunAt(String slot, String weekday, String time, Instant now) {
        if (EVERY_20_MINUTES.equals(slot)) return now.plus(Duration.ofMinutes(20)).toEpochMilli();
        ZonedDateTime local = now.atZone(ZONE);
        DayOfWeek day = DayOfWeek.valueOf(weekday);
        int daysUntil = (day.getValue() - local.getDayOfWeek().getValue() + 7) % 7;
        ZonedDateTime next = local.toLocalDate().plusDays(daysUntil).atTime(LocalTime.parse(time)).atZone(ZONE);
        if (!next.toInstant().isAfter(now)) next = next.plusWeeks(1);
        return next.toInstant().toEpochMilli();
    }

    private void persist(Map<String, ScheduledTemplate> updated) throws IOException {
        Files.createDirectories(file.getParent());
        Path temporary = Files.createTempFile(file.getParent(), "scheduled-templates-", ".json");
        try {
            mapper.writeValue(temporary.toFile(), updated.values());
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    public record ScheduledTemplate(String slot, String to, String name, String language,
                                    List<String> bodyParameters, String weekday, String time, long nextRunAt) {}
}
