package local.editorwhatsapp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class MetaControllerTest {
    private MetaSettings settings;
    private MetaClient client;
    private AutoReplyStore store;
    private MetaController controller;

    @BeforeEach
    void setUp() {
        settings = mock(MetaSettings.class);
        client = mock(MetaClient.class);
        store = mock(AutoReplyStore.class);
        when(settings.adminKey()).thenReturn("local-secret");
        when(settings.webhookConfigured()).thenReturn(true);
        when(settings.appSecret()).thenReturn("app-secret");
        when(settings.verifyToken()).thenReturn("verify-secret");
        when(settings.phoneNumberId()).thenReturn("123456");
        controller = new MetaController(settings, client, store, new ObjectMapper());
    }

    @Test
    void adminEndpointsRequireKey() {
        assertEquals(HttpStatus.UNAUTHORIZED, controller.status(null).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.testSend("wrong", new MetaController.TestSend("5511999999999")).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.autoReply(null,
                new AutoReplyStore.AutoReply("Olá", List.of())).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.disableAutoReply(null).getStatusCode());
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
    void webhookChallengeRequiresMatchingVerifyToken() {
        assertEquals(HttpStatus.FORBIDDEN, controller.verifyWebhook("subscribe", "wrong", "challenge").getStatusCode());
        assertEquals("challenge", controller.verifyWebhook("subscribe", "verify-secret", "challenge").getBody());
    }

    private String sign(byte[] body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("app-secret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return "sha256=" + java.util.HexFormat.of().formatHex(mac.doFinal(body));
    }
}
