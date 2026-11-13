package local.editorwhatsapp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MetaController {
    private static final Pattern PHONE = Pattern.compile("[1-9][0-9]{5,14}");
    private final MetaSettings settings;
    private final MetaClient client;
    private final AutoReplyStore replies;
    private final ObjectMapper mapper;
    private final BotStateStore botState;
    private final Set<String> handledMessages = ConcurrentHashMap.newKeySet();

    public MetaController(MetaSettings settings, MetaClient client, AutoReplyStore replies, ObjectMapper mapper,
                          BotStateStore botState) {
        this.settings = settings;
        this.client = client;
        this.replies = replies;
        this.mapper = mapper;
        this.botState = botState;
    }

    @GetMapping("/api/meta/status")
    public ResponseEntity<?> status(@RequestHeader(value = "X-Admin-Key", required = false) String key) {
        if (!authorized(key)) return unauthorized();
        return ResponseEntity.ok(Map.of("configured", settings.sendConfigured(),
                "mode", settings.sendConfigured() ? "test" : "off",
                "webhookConfigured", settings.webhookConfigured(),
                "autoReplyConfigured", replies.current() != null,
                "botActive", botState.active()));
    }

    @GetMapping("/api/meta/bot-state")
    public ResponseEntity<?> botState(@RequestHeader(value = "X-Admin-Key", required = false) String key) {
        if (!authorized(key)) return unauthorized();
        return ResponseEntity.ok(Map.of("active", botState.active()));
    }

    @PutMapping("/api/meta/bot-state")
    public ResponseEntity<?> setBotState(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                                         @RequestBody BotStateStore.State request) {
        if (!authorized(key)) return unauthorized();
        if (request == null || request.active() == null) return error(HttpStatus.BAD_REQUEST, "Informe o estado do bot.");
        try {
            botState.save(request.active());
            return ResponseEntity.ok(Map.of("active", botState.active()));
        } catch (java.io.IOException exception) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível alterar o estado do bot.");
        }
    }

    @PostMapping("/api/meta/test-send")
    public ResponseEntity<?> testSend(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                                      @RequestBody TestSend request) {
        if (!authorized(key)) return unauthorized();
        if (request == null || request.to() == null || !PHONE.matcher(request.to()).matches()) {
            return error(HttpStatus.BAD_REQUEST, "Use o número internacional somente com dígitos.");
        }
        if (!settings.sendConfigured()) return error(HttpStatus.SERVICE_UNAVAILABLE, "Configure o envio no servidor.");
        try {
            return ResponseEntity.ok(Map.of("messageId", client.sendHelloWorld(request.to())));
        } catch (Exception exception) {
            return error(HttpStatus.BAD_GATEWAY, safeSendError(exception));
        }
    }

    @PostMapping("/api/meta/auto-reply")
    public ResponseEntity<?> autoReply(@RequestHeader(value = "X-Admin-Key", required = false) String key,
                                       @RequestBody AutoReplyStore.AutoReply request) {
        if (!authorized(key)) return unauthorized();
        try {
            replies.save(AutoReplyFlow.normalize(request));
            return ResponseEntity.ok(Map.of("saved", true));
        } catch (IllegalArgumentException exception) {
            return error(HttpStatus.BAD_REQUEST, exception.getMessage());
        } catch (Exception exception) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível salvar a resposta automática.");
        }
    }

    @DeleteMapping("/api/meta/auto-reply")
    public ResponseEntity<?> disableAutoReply(@RequestHeader(value = "X-Admin-Key", required = false) String key) {
        if (!authorized(key)) return unauthorized();
        try {
            replies.delete();
            return ResponseEntity.ok(Map.of("saved", true));
        } catch (Exception exception) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível desativar a resposta automática.");
        }
    }

    @GetMapping(value = "/webhook", produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> verifyWebhook(@RequestParam(value = "hub.mode", required = false) String mode,
                                                 @RequestParam(value = "hub.verify_token", required = false) String token,
                                                 @RequestParam(value = "hub.challenge", required = false) String challenge) {
        if (!settings.webhookConfigured() || !"subscribe".equals(mode) || token == null || challenge == null
                || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                settings.verifyToken().getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("Verificação recusada.");
        }
        return ResponseEntity.ok(challenge);
    }

    @PostMapping("/webhook")
    public ResponseEntity<?> receiveWebhook(@RequestHeader(value = "X-Hub-Signature-256", required = false) String signature,
                                            @RequestBody byte[] body) {
        if (!validSignature(signature, body)) return error(HttpStatus.FORBIDDEN, "Assinatura inválida.");
        try {
            JsonNode event = mapper.readTree(body);
            for (JsonNode entry : event.path("entry")) {
                for (JsonNode change : entry.path("changes")) {
                    JsonNode value = change.path("value");
                    if (!settings.phoneNumberId().equals(value.path("metadata").path("phone_number_id").asText())) continue;
                    for (JsonNode message : value.path("messages")) {
                        if (!botState.active()) continue;
                        String type = message.path("type").asText();
                        if (type.isBlank() || "system".equals(type)) continue;
                        AutoReplyStore.AutoReply reply = replies.current();
                        String id = message.path("id").asText();
                        String from = message.path("from").asText();
                        if (reply == null || id.isBlank() || !PHONE.matcher(from).matches() || !handledMessages.add(id)) continue;
                        try {
                            sendAutoReply(from, message, reply);
                        } catch (Exception exception) {
                            handledMessages.remove(id);
                            return error(HttpStatus.BAD_GATEWAY, safeSendError(exception));
                        }
                    }
                }
            }
            if (handledMessages.size() > 10000) handledMessages.clear();
            return ResponseEntity.ok(Map.of("received", true));
        } catch (Exception exception) {
            return error(HttpStatus.BAD_REQUEST, "Webhook inválido.");
        }
    }

    private boolean authorized(String key) {
        return key != null && !settings.adminKey().isBlank() && MessageDigest.isEqual(
                key.getBytes(StandardCharsets.UTF_8), settings.adminKey().getBytes(StandardCharsets.UTF_8));
    }

    private void sendAutoReply(String from, JsonNode message, AutoReplyStore.AutoReply reply) throws Exception {
        JsonNode interactive = "interactive".equals(message.path("type").asText()) ? message.path("interactive") : mapper.nullNode();
        String buttonId = "button_reply".equals(interactive.path("type").asText())
                ? interactive.path("button_reply").path("id").asText() : "";
        AutoReplyStore.Continuation continuation = AutoReplyFlow.continuation(reply, buttonId);
        if (continuation != null) {
            client.sendContinuation(from, reply, continuation);
            return;
        }
        String rowId = "list_reply".equals(interactive.path("type").asText())
                ? interactive.path("list_reply").path("id").asText() : "";
        String selectedSlot = AutoReplyFlow.selectedSlot(reply, rowId);
        if (selectedSlot != null) {
            client.sendReply(from, new AutoReplyStore.AutoReply("Horário selecionado: " + selectedSlot
                    + ". O agendamento ainda precisa ser confirmado.", List.of()));
            return;
        }
        client.sendReply(from, reply);
    }

    private boolean validSignature(String signature, byte[] body) {
        if (!settings.webhookConfigured() || signature == null || !signature.startsWith("sha256=")) return false;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(settings.appSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] expected = mac.doFinal(body);
            byte[] received = java.util.HexFormat.of().parseHex(signature.substring(7));
            return MessageDigest.isEqual(expected, received);
        } catch (Exception exception) {
            return false;
        }
    }

    private ResponseEntity<Map<String, String>> unauthorized() {
        return error(HttpStatus.UNAUTHORIZED, "Chave de administração ausente ou incorreta.");
    }

    private ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of("error", message));
    }

    private String safeSendError(Exception exception) {
        return exception instanceof IllegalStateException ? exception.getMessage() : "Falha de comunicação com a Meta.";
    }

    public record TestSend(String to) {}
}
