package local.editorwhatsapp;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class BotStateStore {
    private final ObjectMapper mapper;
    private final Path file;
    private volatile boolean active = true;

    @Autowired
    public BotStateStore(ObjectMapper mapper) throws IOException {
        this(mapper, Path.of(System.getenv().getOrDefault("APP_DATA_DIR", "data"), "bot-state.json"));
    }

    BotStateStore(ObjectMapper mapper, Path file) throws IOException {
        this.mapper = mapper;
        this.file = file.toAbsolutePath();
        if (Files.exists(this.file)) {
            State saved = mapper.readValue(this.file.toFile(), State.class);
            if (saved == null || saved.active() == null) throw new IOException("Estado do bot inválido.");
            active = saved.active();
        }
    }

    public boolean active() {
        return active;
    }

    public synchronized void save(boolean nextActive) throws IOException {
        Files.createDirectories(file.getParent());
        Path temporary = Files.createTempFile(file.getParent(), "bot-state-", ".json");
        try {
            mapper.writeValue(temporary.toFile(), new State(nextActive));
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
            active = nextActive;
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    public record State(Boolean active) {}
}
