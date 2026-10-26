package local.editorwhatsapp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class MetaClient {
    private final MetaSettings settings;
    private final ObjectMapper mapper;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public MetaClient(MetaSettings settings, ObjectMapper mapper) {
        this.settings = settings;
        this.mapper = mapper;
    }

    public String sendHelloWorld(String to) throws Exception {
        return send(Map.of("messaging_product", "whatsapp", "to", to, "type", "template",
                "template", Map.of("name", "hello_world", "language", Map.of("code", "en_US"))));
    }

    public String sendReply(String to, AutoReplyStore.AutoReply reply) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("messaging_product", "whatsapp");
        payload.put("to", to);
        if (reply.buttons().isEmpty()) {
            payload.put("type", "text");
            payload.put("text", Map.of("body", reply.text()));
        } else {
            payload.put("type", "interactive");
            payload.put("interactive", Map.of("type", "button", "body", Map.of("text", reply.text()),
                    "action", Map.of("buttons", buttons(reply.buttons()))));
        }
        return send(payload);
    }

    private List<Map<String, Object>> buttons(List<String> labels) {
        return java.util.stream.IntStream.range(0, labels.size()).mapToObj(index -> Map.<String, Object>of(
                "type", "reply", "reply", Map.of("id", "option-" + (index + 1), "title", labels.get(index))))
                .toList();
    }

    private String send(Map<String, Object> payload) throws Exception {
        if (!settings.sendConfigured()) throw new IllegalStateException("Credenciais de envio não configuradas.");
        URI uri = URI.create("https://graph.facebook.com/" + settings.graphVersion() + "/"
                + settings.phoneNumberId() + "/messages");
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(12))
                .header("Authorization", "Bearer " + settings.accessToken())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload))).build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) throw new IllegalStateException("Meta recusou o envio (HTTP " + response.statusCode() + ").");
        JsonNode messages = mapper.readTree(response.body()).path("messages");
        if (!messages.isArray() || messages.isEmpty()) throw new IllegalStateException("Meta não retornou ID da mensagem.");
        return messages.get(0).path("id").asText();
    }
}
