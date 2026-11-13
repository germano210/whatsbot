package local.editorwhatsapp;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class MetaSettingsTest {
    @Test
    void mantemVersaoSimples() {
        assertEquals("v22.0", MetaSettings.normalizeGraphVersion(" v22.0 "));
    }

    @Test
    void extraiVersaoDaUrlOficial() {
        assertEquals("v22.0", MetaSettings.normalizeGraphVersion("https://graph.facebook.com/v22.0/123456789/messages"));
        assertEquals("v19.0", MetaSettings.normalizeGraphVersion("https://graph.facebook.com/v19.0"));
    }

    @Test
    void naoAceitaOutraOrigemNemValorVazio() {
        assertEquals("https://exemplo.com/v22.0/x", MetaSettings.normalizeGraphVersion("https://exemplo.com/v22.0/x"));
        assertEquals("http://graph.facebook.com/v22.0", MetaSettings.normalizeGraphVersion("http://graph.facebook.com/v22.0"));
        assertEquals("", MetaSettings.normalizeGraphVersion(null));
    }
}
