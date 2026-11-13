package local.editorwhatsapp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AutoReplyFlowTest {
    @TempDir
    Path temporary;
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void oldSavedReplyLoadsAndContinuationsPersist() throws Exception {
        Path file = temporary.resolve("auto-reply.json");
        Files.writeString(file, "{\"text\":\"Olá\",\"buttons\":[\"Comprar roupa\"]}");
        AutoReplyStore store = new AutoReplyStore(mapper, file);
        assertEquals(List.of(), store.current().continuations());
        AutoReplyStore.AutoReply flow = flow(List.of("09:00", "10:30"));
        store.save(flow);
        assertEquals(flow, new AutoReplyStore(mapper, file).current());
    }

    @Test
    void validatesButtonsContinuationsAndAvailableSlots() {
        AutoReplyStore.AutoReply normalized = AutoReplyFlow.normalize(new AutoReplyStore.AutoReply(" Olá ",
                List.of("Agendar   horário"), List.of(new AutoReplyStore.Continuation(0, " Escolha um horário ",
                        List.of(" Terça   09:00 ", "Quarta 10:30")))));
        assertEquals("Agendar horário", normalized.buttons().get(0));
        assertEquals("Terça 09:00", normalized.continuations().get(0).slots().get(0));
        for (AutoReplyStore.Continuation invalid : List.of(
                new AutoReplyStore.Continuation(-1, "Texto", List.of()),
                new AutoReplyStore.Continuation(3, "Texto", List.of()),
                new AutoReplyStore.Continuation(null, "Texto", List.of()),
                new AutoReplyStore.Continuation(0, " ", List.of("09:00")),
                new AutoReplyStore.Continuation(0, "Texto", List.of("09:00", " 09:00 ")),
                new AutoReplyStore.Continuation(0, "Texto", List.of("x".repeat(25))),
                new AutoReplyStore.Continuation(0, "Texto", java.util.stream.IntStream.range(0, 11)
                        .mapToObj(String::valueOf).toList()))) {
            assertThrows(IllegalArgumentException.class, () -> AutoReplyFlow.normalize(new AutoReplyStore.AutoReply(
                    "Olá", List.of("Agendar"), List.of(invalid))));
        }
        assertThrows(IllegalArgumentException.class, () -> AutoReplyFlow.normalize(new AutoReplyStore.AutoReply(
                "Olá", List.of("Agendar", "Comprar"), List.of(new AutoReplyStore.Continuation(0, "Um", List.of()),
                        new AutoReplyStore.Continuation(0, "Dois", List.of())))));
    }

    @Test
    void payloadsUseListRowsBoundToCurrentFlowAndBranch() {
        AutoReplyStore.AutoReply flow = flow(List.of("09:00", "10:30"));
        JsonNode initial = mapper.valueToTree(MetaClient.replyPayload("5511999999999", flow));
        String buttonId = initial.path("interactive").path("action").path("buttons").get(2).path("reply").path("id").asText();
        assertEquals(flow.continuations().get(0), AutoReplyFlow.continuation(flow, buttonId));
        JsonNode list = mapper.valueToTree(MetaClient.continuationPayload("5511999999999", flow, flow.continuations().get(0)));
        assertEquals("list", list.path("interactive").path("type").asText());
        JsonNode rows = list.path("interactive").path("action").path("sections").get(0).path("rows");
        assertEquals(2, rows.size());
        assertEquals("09:00", AutoReplyFlow.selectedSlot(flow, rows.get(0).path("id").asText()));
        assertNull(AutoReplyFlow.continuation(flow, AutoReplyFlow.buttonId(flow, 0)));
        AutoReplyStore.AutoReply updated = flow(List.of("11:00"));
        assertNotEquals(buttonId, AutoReplyFlow.buttonId(updated, 2));
        assertNull(AutoReplyFlow.continuation(updated, buttonId));
        assertNull(AutoReplyFlow.selectedSlot(updated, rows.get(0).path("id").asText()));
    }

    @Test
    void textContinuationDoesNotBecomeInteractiveList() {
        AutoReplyStore.AutoReply flow = flow(List.of());
        JsonNode payload = mapper.valueToTree(MetaClient.continuationPayload("5511999999999", flow, flow.continuations().get(0)));
        assertEquals("text", payload.path("type").asText());
        assertEquals("Escolha um horário", payload.path("text").path("body").asText());
    }

    private AutoReplyStore.AutoReply flow(List<String> slots) {
        return new AutoReplyStore.AutoReply("Como podemos ajudar?", List.of("Comprar roupa", "Vender roupa", "Agendar horário"),
                List.of(new AutoReplyStore.Continuation(2, "Escolha um horário", slots)));
    }
}
