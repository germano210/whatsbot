package local.editorwhatsapp;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;

final class AutoReplyFlow {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AutoReplyFlow() {}

    static AutoReplyStore.AutoReply normalize(AutoReplyStore.AutoReply request) {
        if (request == null || request.text() == null || request.buttons() == null) {
            throw new IllegalArgumentException("Texto e botões são obrigatórios.");
        }
        String text = request.text().trim();
        List<String> buttons = request.buttons().stream().map(AutoReplyFlow::label).toList();
        if (!validText(text, buttons.isEmpty() ? 4096 : 1024) || buttons.size() > 3
                || !validLabels(buttons, 20)) {
            throw new IllegalArgumentException("Mensagem ou botões fora dos limites do WhatsApp.");
        }
        if (request.continuations().size() > buttons.size()) {
            throw new IllegalArgumentException("Cada botão pode ter apenas uma continuação.");
        }
        Set<Integer> indexes = new HashSet<>();
        List<AutoReplyStore.Continuation> continuations = new ArrayList<>();
        for (AutoReplyStore.Continuation continuation : request.continuations()) {
            if (continuation == null || continuation.buttonIndex() == null || continuation.buttonIndex() < 0
                    || continuation.buttonIndex() >= buttons.size() || !indexes.add(continuation.buttonIndex())) {
                throw new IllegalArgumentException("Continuação sem botão válido ou com botão duplicado.");
            }
            List<String> slots = continuation.slots().stream().map(AutoReplyFlow::label).toList();
            String message = continuation.text() == null ? "" : continuation.text().trim();
            if (slots.size() > 10 || !validLabels(slots, 24) || !validText(message, slots.isEmpty() ? 4096 : 1024)) {
                throw new IllegalArgumentException("Use texto válido e até dez horários únicos de até 24 caracteres.");
            }
            continuations.add(new AutoReplyStore.Continuation(continuation.buttonIndex(), message, List.copyOf(slots)));
        }
        return new AutoReplyStore.AutoReply(text, List.copyOf(buttons), List.copyOf(continuations));
    }

    static String buttonId(AutoReplyStore.AutoReply reply, int index) {
        return (reply.continuations().isEmpty() ? "" : "flow-" + fingerprint(reply) + "-") + "option-" + (index + 1);
    }

    static String slotId(AutoReplyStore.AutoReply reply, int buttonIndex, int slotIndex) {
        return "flow-" + fingerprint(reply) + "-slot-" + (buttonIndex + 1) + "-" + (slotIndex + 1);
    }

    static AutoReplyStore.Continuation continuation(AutoReplyStore.AutoReply reply, String buttonId) {
        for (AutoReplyStore.Continuation continuation : reply.continuations()) {
            if (buttonId(reply, continuation.buttonIndex()).equals(buttonId)) return continuation;
        }
        return null;
    }

    static String selectedSlot(AutoReplyStore.AutoReply reply, String rowId) {
        for (AutoReplyStore.Continuation continuation : reply.continuations()) {
            for (int index = 0; index < continuation.slots().size(); index++) {
                if (slotId(reply, continuation.buttonIndex(), index).equals(rowId)) return continuation.slots().get(index);
            }
        }
        return null;
    }

    private static String fingerprint(AutoReplyStore.AutoReply reply) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(MAPPER.writeValueAsBytes(reply)), 0, 8);
        } catch (Exception exception) {
            throw new IllegalStateException("Não foi possível identificar o fluxo.");
        }
    }

    private static String label(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ");
    }

    private static boolean validText(String text, int limit) {
        return !text.isBlank() && text.codePointCount(0, text.length()) <= limit;
    }

    private static boolean validLabels(List<String> labels, int limit) {
        Set<String> seen = new HashSet<>();
        return labels.stream().allMatch(value -> validText(value, limit) && seen.add(value.toLowerCase(Locale.ROOT)));
    }
}
