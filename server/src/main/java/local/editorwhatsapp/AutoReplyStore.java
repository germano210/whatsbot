package local.editorwhatsapp;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class AutoReplyStore {
    private final ObjectMapper mapper;
    private final Path file;
    private volatile AutoReply current;

    @Autowired
    public AutoReplyStore(ObjectMapper mapper) throws IOException {
        this(mapper, Path.of(System.getenv().getOrDefault("APP_DATA_DIR", "data"), "auto-reply.json"));
    }

    AutoReplyStore(ObjectMapper mapper, Path file) throws IOException {
        this.mapper = mapper;
        this.file = file.toAbsolutePath();
        if (Files.exists(this.file)) current = AutoReplyFlow.normalize(mapper.readValue(this.file.toFile(), AutoReply.class));
    }

    public AutoReply current() { return current; }

    public synchronized void save(AutoReply reply) throws IOException {
        Files.createDirectories(file.toAbsolutePath().getParent());
        Path temporary = Files.createTempFile(file.toAbsolutePath().getParent(), "auto-reply-", ".json");
        try {
            mapper.writeValue(temporary.toFile(), reply);
            Files.move(temporary, file.toAbsolutePath(), StandardCopyOption.REPLACE_EXISTING);
            current = reply;
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    public synchronized void delete() throws IOException {
        Files.deleteIfExists(file);
        current = null;
    }

    public record AutoReply(String text, List<String> buttons, List<Continuation> continuations) {
        public AutoReply {
            continuations = continuations == null ? List.of() : continuations;
        }

        public AutoReply(String text, List<String> buttons) {
            this(text, buttons, List.of());
        }
    }

    public record Continuation(Integer buttonIndex, String text, List<String> slots) {
        public Continuation {
            slots = slots == null ? List.of() : slots;
        }
    }
}
