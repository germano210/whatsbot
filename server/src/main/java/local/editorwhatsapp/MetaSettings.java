package local.editorwhatsapp;

import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class MetaSettings {
    private static final Pattern GRAPH_VERSION = Pattern.compile("v[0-9]+\\.[0-9]+");
    private static final Pattern PHONE_ID = Pattern.compile("[0-9]+");

    public String accessToken() { return value("META_ACCESS_TOKEN"); }
    public String phoneNumberId() { return value("META_PHONE_NUMBER_ID"); }
    public String graphVersion() { return value("META_GRAPH_VERSION"); }
    public String verifyToken() { return value("META_WEBHOOK_VERIFY_TOKEN"); }
    public String appSecret() { return value("META_APP_SECRET"); }
    public String adminKey() { return value("APP_ADMIN_KEY"); }
    public String testRecipient() { return value("APP_TEST_RECIPIENT"); }

    public boolean sendConfigured() {
        return !accessToken().isBlank() && PHONE_ID.matcher(phoneNumberId()).matches()
                && GRAPH_VERSION.matcher(graphVersion()).matches();
    }

    public boolean webhookConfigured() {
        return !verifyToken().isBlank() && !appSecret().isBlank();
    }

    private String value(String name) {
        return System.getenv().getOrDefault(name, "").trim();
    }
}
