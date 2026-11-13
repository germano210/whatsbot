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

    public String sendTemplate(String to, String name, String language, List<String> bodyParameters) throws Exception {
        Map<String, Object> template = new LinkedHashMap<>();
        template.put("name", name);
        template.put("language", Map.of("code", language));
        if (!bodyParameters.isEmpty()) {
            template.put("components", List.of(Map.of("type", "body", "parameters", bodyParameters.stream()
                    .map(value -> Map.of("type", "text", "text", value)).toList())));
        }
        return send(Map.of("messaging_product", "whatsapp", "to", to, "type", "template", "template", template));
    }

    public String sendReply(String to, AutoReplyStore.AutoReply reply) throws Exception {
        return send(replyPayload(to, reply));
    }

    static Map<String, Object> replyPayload(String to, AutoReplyStore.AutoReply reply) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("messaging_product", "whatsapp");
        payload.put("to", to);
        if (reply.buttons().isEmpty()) {
            payload.put("type", "text");
            payload.put("text", Map.of("body", reply.text()));
        } else {
            payload.put("type", "interactive");
            payload.put("interactive", Map.of("type", "button", "body", Map.of("text", reply.text()),
                    "action", Map.of("buttons", buttons(reply))));
        }
        return payload;
    }

    public String sendContinuation(String to, AutoReplyStore.AutoReply reply, AutoReplyStore.Continuation continuation) throws Exception {
        return send(continuationPayload(to, reply, continuation));
    }

    static Map<String, Object> continuationPayload(String to, AutoReplyStore.AutoReply reply,
                                                  AutoReplyStore.Continuation continuation) {
        if (continuation.slots().isEmpty()) {
            return replyPayload(to, new AutoReplyStore.AutoReply(continuation.text(), List.of()));
        }
        List<Map<String, String>> rows = java.util.stream.IntStream.range(0, continuation.slots().size())
                .mapToObj(index -> Map.of("id", AutoReplyFlow.slotId(reply, continuation.buttonIndex(), index),
                        "title", continuation.slots().get(index))).toList();
        return Map.of("messaging_product", "whatsapp", "to", to, "type", "interactive",
                "interactive", Map.of("type", "list", "body", Map.of("text", continuation.text()),
                        "action", Map.of("button", "Ver horários", "sections", List.of(
                                Map.of("title", "Horários disponíveis", "rows", rows)))));
    }

    private static List<Map<String, Object>> buttons(AutoReplyStore.AutoReply reply) {
        return java.util.stream.IntStream.range(0, reply.buttons().size()).mapToObj(index -> Map.<String, Object>of(
                "type", "reply", "reply", Map.of("id", AutoReplyFlow.buttonId(reply, index), "title", reply.buttons().get(index))))
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
