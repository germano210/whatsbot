package local.editorwhatsapp;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.DayOfWeek;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/meta/schedules")
public class ScheduledTemplateController {
    private static final Pattern PHONE = Pattern.compile("[1-9][0-9]{5,14}");
    private static final Pattern NAME = Pattern.compile("[a-z0-9_]{1,512}");
    private static final Pattern LANGUAGE = Pattern.compile("[a-z]{2,3}(?:_[A-Z]{2})?");
    private static final Pattern TIME = Pattern.compile("(?:[01][0-9]|2[0-3]):[0-5][0-9]");
    private final MetaSettings settings;
    private final ScheduledTemplateStore store;

    public ScheduledTemplateController(MetaSettings settings, ScheduledTemplateStore store) {
        this.settings = settings;
        this.store = store;
    }

    @GetMapping
    public ResponseEntity<?> list(@RequestHeader(value = "X-Admin-Key", required = false) String key) {
        if (!authorized(key)) return unauthorized();
        return ResponseEntity.ok(Map.of("schedules", store.all()));
    }

    @PutMapping("/{slot}")
    public ResponseEntity<?> save(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                                  @PathVariable String slot, @RequestBody ScheduleRequest request) {
        if (!authorized(key)) return unauthorized();
        if (!validSlot(slot) || request == null || !Boolean.TRUE.equals(request.consentConfirmed())
                || request.to() == null || !PHONE.matcher(request.to()).matches()
                || !request.to().equals(settings.testRecipient())
                || request.name() == null || !NAME.matcher(request.name()).matches()
                || request.language() == null || !LANGUAGE.matcher(request.language()).matches()) {
            return error(HttpStatus.BAD_REQUEST, "Informe o template aprovado, o destinatário de teste autorizado e confirme o consentimento.");
        }
        List<String> parameters = request.bodyParameters() == null ? List.of() : request.bodyParameters();
        if (parameters.size() > 10 || parameters.stream().anyMatch(value -> value == null || value.isBlank()
                || value.length() > 1024)) {
            return error(HttpStatus.BAD_REQUEST, "Parâmetros do template inválidos.");
        }
        String weekday = null;
        String time = null;
        if (ScheduledTemplateStore.WEEKLY.equals(slot)) {
            weekday = request.weekday();
            time = request.time();
            if (!validWeekday(weekday) || time == null || !TIME.matcher(time).matches()) {
                return error(HttpStatus.BAD_REQUEST, "Informe dia da semana e horário HH:mm no fuso de São Paulo.");
            }
        }
        try {
            return ResponseEntity.ok(store.save(slot, request.to(), request.name(), request.language(),
                    parameters, weekday, time, Instant.now()));
        } catch (IOException exception) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível salvar o agendamento.");
        }
    }

    @DeleteMapping("/{slot}")
    public ResponseEntity<?> delete(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                                    @PathVariable String slot) {
        if (!authorized(key)) return unauthorized();
        if (!validSlot(slot)) return error(HttpStatus.BAD_REQUEST, "Agendamento inválido.");
        try {
            store.delete(slot);
            return ResponseEntity.ok(Map.of("deleted", true));
        } catch (IOException exception) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível remover o agendamento.");
        }
    }

    private boolean authorized(String key) {
        return key != null && !settings.adminKey().isBlank() && MessageDigest.isEqual(
                key.getBytes(StandardCharsets.UTF_8), settings.adminKey().getBytes(StandardCharsets.UTF_8));
    }

    private boolean validSlot(String slot) {
        return ScheduledTemplateStore.EVERY_20_MINUTES.equals(slot) || ScheduledTemplateStore.WEEKLY.equals(slot);
    }

    private boolean validWeekday(String weekday) {
        if (weekday == null) return false;
        try {
            DayOfWeek.valueOf(weekday);
            return true;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private ResponseEntity<Map<String, String>> unauthorized() {
        return error(HttpStatus.UNAUTHORIZED, "Chave de administração ausente ou incorreta.");
    }

    private ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of("error", message));
    }

    public record ScheduleRequest(String to, String name, String language, List<String> bodyParameters,
                                  String weekday, String time, Boolean consentConfirmed) {}
}
