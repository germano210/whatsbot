package local.editorwhatsapp;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class AutoReplyStore {
    private final ObjectMapper mapper;
    private final Path file;
    private volatile AutoReply current;

    public AutoReplyStore(ObjectMapper mapper) throws IOException {
        this.mapper = mapper;
        this.file = Path.of(System.getenv().getOrDefault("APP_DATA_DIR", "data"), "auto-reply.json");
        if (Files.exists(file)) current = mapper.readValue(file.toFile(), AutoReply.class);
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

    public record AutoReply(String text, List<String> buttons) {}
}
