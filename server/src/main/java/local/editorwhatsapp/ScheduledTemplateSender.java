package local.editorwhatsapp;

import java.io.IOException;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ScheduledTemplateSender {
    private static final Logger LOGGER = LoggerFactory.getLogger(ScheduledTemplateSender.class);
    private final MetaSettings settings;
    private final MetaClient client;
    private final ScheduledTemplateStore store;
    private final BotStateStore botState;

    public ScheduledTemplateSender(MetaSettings settings, MetaClient client, ScheduledTemplateStore store,
                                    BotStateStore botState) {
        this.settings = settings;
        this.client = client;
        this.store = store;
        this.botState = botState;
    }

    @Scheduled(fixedDelay = 30000, initialDelay = 30000)
    public void sendDue() {
        sendDue(Instant.now());
    }

    void sendDue(Instant now) {
        if (!settings.sendConfigured() || !botState.active()) return;
        try {
            for (ScheduledTemplateStore.ScheduledTemplate schedule : store.claimDue(now)) {
                if (!botState.active()) return;
                if (!schedule.to().equals(settings.testRecipient())) {
                    LOGGER.warn("Agendamento {} ignorado: destinatário de teste não confere.", schedule.slot());
                    continue;
                }
                try {
                    client.sendTemplate(schedule.to(), schedule.name(), schedule.language(), schedule.bodyParameters());
                } catch (Exception exception) {
                    LOGGER.warn("Envio agendado {} falhou; confira o template e a configuração da Meta.", schedule.slot());
                }
            }
        } catch (IOException exception) {
            LOGGER.error("Não foi possível atualizar os agendamentos antes do envio.");
        }
    }
}
