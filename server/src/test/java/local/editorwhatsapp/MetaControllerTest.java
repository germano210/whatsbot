package local.editorwhatsapp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class MetaControllerTest {
    @TempDir
    Path temporary;
    private MetaSettings settings;
    private MetaClient client;
    private AutoReplyStore store;
    private MetaController controller;
    private BotStateStore botState;

    @BeforeEach
    void setUp() throws Exception {
        settings = mock(MetaSettings.class);
        client = mock(MetaClient.class);
        store = mock(AutoReplyStore.class);
        when(settings.adminKey()).thenReturn("local-secret");
        when(settings.webhookConfigured()).thenReturn(true);
        when(settings.appSecret()).thenReturn("app-secret");
        when(settings.verifyToken()).thenReturn("verify-secret");
        when(settings.phoneNumberId()).thenReturn("123456");
        botState = new BotStateStore(new ObjectMapper(), temporary.resolve("bot-state.json"));
        controller = new MetaController(settings, client, store, new ObjectMapper(), botState);
    }

    @Test
    void adminEndpointsRequireKey() {
        assertEquals(HttpStatus.UNAUTHORIZED, controller.status(null).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.testSend("wrong", new MetaController.TestSend("5511999999999")).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.autoReply(null,
                new AutoReplyStore.AutoReply("Olá", List.of())).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.disableAutoReply(null).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.botState(null).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.setBotState(null, new BotStateStore.State(false)).getStatusCode());
    }

    @Test
    void botStateCanBePausedPersistedAndResumed() throws Exception {
        assertEquals(HttpStatus.BAD_REQUEST, controller.setBotState("local-secret", new BotStateStore.State(null)).getStatusCode());
        assertEquals(Map.of("active", true), controller.botState("local-secret").getBody());
        assertEquals(Map.of("active", false), controller.setBotState("local-secret", new BotStateStore.State(false)).getBody());
        assertEquals(false, new BotStateStore(new ObjectMapper(), temporary.resolve("bot-state.json")).active());
        assertEquals(false, ((Map<?, ?>) controller.status("local-secret").getBody()).get("botActive"));
        assertEquals(Map.of("active", true), controller.setBotState("local-secret", new BotStateStore.State(true)).getBody());
    }

    @Test
    void pausedBotAcknowledgesWebhookWithoutReplyAndKeepsConfiguration() throws Exception {
        AutoReplyStore.AutoReply reply = new AutoReplyStore.AutoReply("Olá", List.of("Continuar"));
        when(store.current()).thenReturn(reply);
        botState.save(false);
        byte[] body = webhookBody("123456", List.of(Map.of(
                "id", "wamid.paused", "from", "5511999999999", "type", "text")));

        assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(body), body).getStatusCode());
        verify(client, never()).sendReply(any(), any());
        verify(store, never()).delete();
    }

    @Test
    void disableAutoReplyClearsSavedResponse() throws Exception {
        assertEquals(HttpStatus.OK, controller.disableAutoReply("local-secret").getStatusCode());
        verify(store).delete();
    }

    @Test
    void testSendUsesOnlyApprovedHelloWorldTemplate() throws Exception {
        when(settings.sendConfigured()).thenReturn(true);
        when(client.sendHelloWorld("5511999999999")).thenReturn("wamid.test");
        ResponseEntity<?> response = controller.testSend("local-secret", new MetaController.TestSend("5511999999999"));
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals(Map.of("messageId", "wamid.test"), response.getBody());
        assertEquals(HttpStatus.BAD_REQUEST, controller.testSend("local-secret", new MetaController.TestSend("+55 11")).getStatusCode());
    }

    @Test
    void autoReplyValidatesButtonsBeforeSaving() throws Exception {
        assertEquals(HttpStatus.BAD_REQUEST, controller.autoReply("local-secret",
                new AutoReplyStore.AutoReply("Promoção", List.of("Um", "Dois", "Três", "Quatro"))).getStatusCode());
        verify(store, never()).save(any());
        assertEquals(HttpStatus.OK, controller.autoReply("local-secret",
                new AutoReplyStore.AutoReply("Promoção", List.of("Quero saber mais"))).getStatusCode());
        verify(store).save(eq(new AutoReplyStore.AutoReply("Promoção", List.of("Quero saber mais"))));
    }

    @Test
    void webhookRejectsBadSignatureAndRepliesOnce() throws Exception {
        AutoReplyStore.AutoReply reply = new AutoReplyStore.AutoReply("Olá!", List.of());
        when(store.current()).thenReturn(reply);
        byte[] body = "{\"entry\":[{\"changes\":[{\"value\":{\"metadata\":{\"phone_number_id\":\"123456\"},\"messages\":[{\"id\":\"wamid.incoming\",\"from\":\"5511999999999\",\"type\":\"text\"}]}}]}]}".getBytes(StandardCharsets.UTF_8);
        assertEquals(HttpStatus.FORBIDDEN, controller.receiveWebhook("sha256=bad", body).getStatusCode());
        String signature = sign(body);
        assertEquals(HttpStatus.OK, controller.receiveWebhook(signature, body).getStatusCode());
        assertEquals(HttpStatus.OK, controller.receiveWebhook(signature, body).getStatusCode());
        verify(client).sendReply("5511999999999", reply);
    }

    @Test
    void webhookRepliesToEveryInboundMessageTypeWithActiveTextAndOptions() throws Exception {
        AutoReplyStore.AutoReply reply = new AutoReplyStore.AutoReply("Escolha uma opção", List.of("Sim", "Não"));
        when(store.current()).thenReturn(reply);
        List<String> types = List.of("text", "image", "audio", "video", "document", "sticker",
                "location", "contacts", "interactive", "button", "reaction", "order", "unknown");
        List<Map<String, String>> messages = java.util.stream.IntStream.range(0, types.size())
                .mapToObj(index -> Map.of("id", "wamid." + index, "from", "5511999999999", "type", types.get(index)))
                .toList();
        byte[] body = webhookBody("123456", messages);

        assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(body), body).getStatusCode());
        assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(body), body).getStatusCode());
        verify(client, times(types.size())).sendReply("5511999999999", reply);
    }

    @Test
    void webhookDoesNotReplyToStatusesInvalidMessagesOrOtherPhoneNumber() throws Exception {
        when(store.current()).thenReturn(new AutoReplyStore.AutoReply("Olá", List.of("Continuar")));
        byte[] statuses = new ObjectMapper().writeValueAsBytes(Map.of("entry", List.of(Map.of("changes", List.of(
                Map.of("value", Map.of("metadata", Map.of("phone_number_id", "123456"),
                        "statuses", List.of(Map.of("id", "wamid.outgoing", "status", "sent")))))))));
        byte[] missingType = webhookBody("123456", List.of(Map.of("id", "wamid.invalid", "from", "5511999999999")));
        byte[] wrongPhone = webhookBody("different", List.of(Map.of("id", "wamid.other", "from", "5511999999999", "type", "image")));
        byte[] invalidSender = webhookBody("123456", List.of(Map.of("id", "wamid.bad-sender", "from", "invalid", "type", "image")));
        byte[] systemMessage = webhookBody("123456", List.of(Map.of("id", "wamid.system", "from", "5511999999999", "type", "system")));

        for (byte[] body : List.of(statuses, missingType, wrongPhone, invalidSender, systemMessage)) {
            assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(body), body).getStatusCode());
        }
        verify(client, never()).sendReply(any(), any());
    }

    @Test
    void webhookDoesNotReplyWithoutActiveConfiguration() throws Exception {
        byte[] body = webhookBody("123456", List.of(Map.of(
                "id", "wamid.incoming", "from", "5511999999999", "type", "image")));

        assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(body), body).getStatusCode());
        verify(client, never()).sendReply(any(), any());
    }

    @Test
    void savesValidatedContinuationsAndRejectsInvalidBranch() throws Exception {
        AutoReplyStore.AutoReply invalid = new AutoReplyStore.AutoReply("Olá", List.of("Agendar"),
                List.of(new AutoReplyStore.Continuation(1, "Escolha", List.of("09:00"))));
        assertEquals(HttpStatus.BAD_REQUEST, controller.autoReply("local-secret", invalid).getStatusCode());
        verify(store, never()).save(any());
        AutoReplyStore.AutoReply valid = scheduledReply();
        assertEquals(HttpStatus.OK, controller.autoReply("local-secret", valid).getStatusCode());
        verify(store).save(valid);
    }

    @Test
    void selectedButtonSendsItsContinuationOnceInsteadOfInitialReply() throws Exception {
        AutoReplyStore.AutoReply reply = scheduledReply();
        when(store.current()).thenReturn(reply);
        byte[] body = selectionBody("wamid.button", "button_reply", AutoReplyFlow.buttonId(reply, 1));
        assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(body), body).getStatusCode());
        assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(body), body).getStatusCode());
        verify(client).sendContinuation("5511999999999", reply, reply.continuations().get(0));
        verify(client, never()).sendReply(any(), any());
    }

    @Test
    void selectedSlotUsesConfiguredTitleAndDoesNotConfirmBooking() throws Exception {
        AutoReplyStore.AutoReply reply = scheduledReply();
        when(store.current()).thenReturn(reply);
        byte[] body = selectionBody("wamid.slot", "list_reply", AutoReplyFlow.slotId(reply, 1, 0));
        assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(body), body).getStatusCode());
        verify(client).sendReply("5511999999999", new AutoReplyStore.AutoReply(
                "Horário selecionado: 09:00. O agendamento ainda precisa ser confirmado.", List.of()));
        verify(client, never()).sendContinuation(any(), any(), any());
    }

    @Test
    void unknownSelectionReturnsInitialMenuAndPausedBotDoesNotContinue() throws Exception {
        AutoReplyStore.AutoReply reply = scheduledReply();
        when(store.current()).thenReturn(reply);
        byte[] unknown = selectionBody("wamid.unknown", "list_reply", "invalid-row");
        assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(unknown), unknown).getStatusCode());
        verify(client).sendReply("5511999999999", reply);
        botState.save(false);
        byte[] paused = selectionBody("wamid.button-paused", "button_reply", AutoReplyFlow.buttonId(reply, 1));
        assertEquals(HttpStatus.OK, controller.receiveWebhook(sign(paused), paused).getStatusCode());
        verify(client, never()).sendContinuation(any(), any(), any());
    }

    @Test
    void webhookChallengeRequiresMatchingVerifyToken() {
        assertEquals(HttpStatus.FORBIDDEN, controller.verifyWebhook("subscribe", "wrong", "challenge").getStatusCode());
        assertEquals("challenge", controller.verifyWebhook("subscribe", "verify-secret", "challenge").getBody());
    }

    private String sign(byte[] body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("app-secret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return "sha256=" + java.util.HexFormat.of().formatHex(mac.doFinal(body));
    }

    private AutoReplyStore.AutoReply scheduledReply() {
        return new AutoReplyStore.AutoReply("Olá", List.of("Comprar roupa", "Agendar horário"),
                List.of(new AutoReplyStore.Continuation(1, "Escolha um horário", List.of("09:00", "10:30"))));
    }

    private byte[] selectionBody(String id, String type, String selectionId) throws Exception {
        return new ObjectMapper().writeValueAsBytes(Map.of("entry", List.of(Map.of("changes", List.of(
                Map.of("value", Map.of("metadata", Map.of("phone_number_id", "123456"), "messages", List.of(
                        Map.of("id", id, "from", "5511999999999", "type", "interactive", "interactive",
                                Map.of("type", type, type, Map.of("id", selectionId, "title", "Título externo ignorado")))))))))));
    }

    private byte[] webhookBody(String phoneNumberId, List<Map<String, String>> messages) throws Exception {
        return new ObjectMapper().writeValueAsBytes(Map.of("entry", List.of(Map.of("changes", List.of(
                Map.of("value", Map.of("metadata", Map.of("phone_number_id", phoneNumberId),
                        "messages", messages)))))));
    }
}
