package space.pismo.app;

import android.content.Context;
import android.content.SharedPreferences;

/** Хранилище push-токена RuStore между запусками приложения. */
final class PushTokenStore {

    private static final String PREFS = "pismo_native";
    private static final String KEY_TOKEN = "rustore_push_token";

    private PushTokenStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context context, String token) {
        if (token == null || token.isEmpty()) {
            return;
        }
        prefs(context).edit().putString(KEY_TOKEN, token).apply();
    }

    /** Текущий push-токен или пустая строка. */
    static String get(Context context) {
        return prefs(context).getString(KEY_TOKEN, "");
    }
}
