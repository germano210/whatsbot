package local.editorwhatsapp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;

class ScheduledTemplateTest {
    @TempDir
    Path temporary;

    @Test
    void twentyMinuteScheduleIsPersistedAndClaimedOnlyOnce() throws Exception {
        Path file = temporary.resolve("scheduled-templates.json");
        ScheduledTemplateStore store = new ScheduledTemplateStore(new ObjectMapper(), file);
        Instant now = Instant.parse("2026-10-26T12:00:00Z");
        store.save(ScheduledTemplateStore.EVERY_20_MINUTES, "5511999999999", "oferta_teste", "pt_BR",
                List.of("Cami"), null, null, now);

        assertTrue(store.claimDue(now.plusSeconds(1199)).isEmpty());
        assertEquals(1, store.claimDue(now.plusSeconds(1200)).size());
        assertTrue(new ScheduledTemplateStore(new ObjectMapper(), file).claimDue(now.plusSeconds(1200)).isEmpty());
        assertEquals(now.plusSeconds(2400).toEpochMilli(), store.all().get(0).nextRunAt());
    }

    @Test
    void weeklyScheduleUsesSaoPauloAndSkipsPastTime() throws Exception {
        Instant mondayNine = Instant.parse("2026-10-26T12:00:00Z");
        assertEquals(Instant.parse("2026-10-26T13:00:00Z").toEpochMilli(),
                ScheduledTemplateStore.nextRunAt(ScheduledTemplateStore.WEEKLY, "MONDAY", "10:00", mondayNine));
        assertEquals(Instant.parse("2026-11-02T13:00:00Z").toEpochMilli(),
                ScheduledTemplateStore.nextRunAt(ScheduledTemplateStore.WEEKLY, "MONDAY", "10:00",
                        mondayNine.plusSeconds(3600)));
    }

    @Test
    void onlyAuthorizedConsentedTestRecipientCanBeScheduled() throws Exception {
        MetaSettings settings = mock(MetaSettings.class);
        when(settings.adminKey()).thenReturn("admin-test");
        when(settings.testRecipient()).thenReturn("5511999999999");
        ScheduledTemplateStore store = new ScheduledTemplateStore(new ObjectMapper(),
                temporary.resolve("scheduled-templates.json"));
        ScheduledTemplateController controller = new ScheduledTemplateController(settings, store);
        ScheduledTemplateController.ScheduleRequest request = new ScheduledTemplateController.ScheduleRequest(
                "5511999999999", "oferta_teste", "pt_BR", List.of(), "MONDAY", "10:00", true);

        assertEquals(HttpStatus.UNAUTHORIZED, controller.save(null, "weekly", request).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, controller.save("admin-test", "weekly",
                new ScheduledTemplateController.ScheduleRequest("5511888888888", "oferta_teste", "pt_BR",
                        List.of(), "MONDAY", "10:00", true)).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, controller.save("admin-test", "weekly",
                new ScheduledTemplateController.ScheduleRequest("5511999999999", "oferta_teste", "pt_BR",
                        List.of(), "MONDAY", "10:00", false)).getStatusCode());
        assertEquals(HttpStatus.OK, controller.save("admin-test", "weekly", request).getStatusCode());
        assertEquals(1, store.all().size());
        assertEquals(HttpStatus.OK, controller.delete("admin-test", "weekly").getStatusCode());
        assertTrue(store.all().isEmpty());
    }

    @Test
    void senderRequiresCredentialsAndDoesNotRepeatClaimedTemplate() throws Exception {
        MetaSettings settings = mock(MetaSettings.class);
        MetaClient client = mock(MetaClient.class);
        ScheduledTemplateStore store = new ScheduledTemplateStore(new ObjectMapper(),
                temporary.resolve("scheduled-templates.json"));
        Instant now = Instant.parse("2026-10-26T12:00:00Z");
        store.save(ScheduledTemplateStore.EVERY_20_MINUTES, "5511999999999", "oferta_teste", "pt_BR",
                List.of(), null, null, now);
        ScheduledTemplateSender sender = new ScheduledTemplateSender(settings, client, store,
                new BotStateStore(new ObjectMapper(), temporary.resolve("bot-state.json")));

        sender.sendDue(now.plusSeconds(1200));
        verify(client, never()).sendTemplate("5511999999999", "oferta_teste", "pt_BR", List.of());
        when(settings.sendConfigured()).thenReturn(true);
        when(settings.testRecipient()).thenReturn("5511999999999");
        sender.sendDue(now.plusSeconds(1200));
        sender.sendDue(now.plusSeconds(1200));
        verify(client).sendTemplate("5511999999999", "oferta_teste", "pt_BR", List.of());
    }

    @Test
    void senderSkipsScheduleIfTestRecipientWasChanged() throws Exception {
        MetaSettings settings = mock(MetaSettings.class);
        MetaClient client = mock(MetaClient.class);
        ScheduledTemplateStore store = new ScheduledTemplateStore(new ObjectMapper(),
                temporary.resolve("scheduled-templates.json"));
        Instant now = Instant.parse("2026-10-26T12:00:00Z");
        store.save(ScheduledTemplateStore.WEEKLY, "5511999999999", "novidades_teste", "pt_BR",
                List.of(), "MONDAY", "10:00", now);
        when(settings.sendConfigured()).thenReturn(true);
        when(settings.testRecipient()).thenReturn("5511888888888");

        new ScheduledTemplateSender(settings, client, store,
                new BotStateStore(new ObjectMapper(), temporary.resolve("bot-state.json"))).sendDue(now.plusSeconds(3600));

        verify(client, never()).sendTemplate("5511999999999", "novidades_teste", "pt_BR", List.of());
    }

    @Test
    void pausedBotKeepsScheduleAndCanResumeSending() throws Exception {
        MetaSettings settings = mock(MetaSettings.class);
        MetaClient client = mock(MetaClient.class);
        ScheduledTemplateStore store = new ScheduledTemplateStore(new ObjectMapper(),
                temporary.resolve("scheduled-templates.json"));
        BotStateStore botState = new BotStateStore(new ObjectMapper(), temporary.resolve("bot-state.json"));
        Instant now = Instant.parse("2026-10-26T12:00:00Z");
        store.save(ScheduledTemplateStore.EVERY_20_MINUTES, "5511999999999", "oferta_teste", "pt_BR",
                List.of(), null, null, now);
        when(settings.sendConfigured()).thenReturn(true);
        when(settings.testRecipient()).thenReturn("5511999999999");
        ScheduledTemplateSender sender = new ScheduledTemplateSender(settings, client, store, botState);
        botState.save(false);

        sender.sendDue(now.plusSeconds(1200));

        assertEquals(now.plusSeconds(1200).toEpochMilli(), store.all().get(0).nextRunAt());
        verify(client, never()).sendTemplate("5511999999999", "oferta_teste", "pt_BR", List.of());
        botState.save(true);
        sender.sendDue(now.plusSeconds(1200));
        verify(client).sendTemplate("5511999999999", "oferta_teste", "pt_BR", List.of());
    }
}
