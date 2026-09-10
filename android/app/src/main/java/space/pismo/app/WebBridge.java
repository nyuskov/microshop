package space.pismo.app;

import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Map;

/**
 * Мост «нативная часть → веб-приложение».
 *
 * Веб-приложение (тот же самый PWA-фронтенд) подписывается на DOM-события
 * {@code pismo:*} и не знает о нативном слое ничего, кроме них: это позволяет
 * не тянуть нативную логику в веб и не ломать браузерную версию.
 *
 * События:
 * <ul>
 *     <li>{@code pismo:rustore-token} — получен/обновился push-токен RuStore;</li>
 *     <li>{@code pismo:push-status} — статус push (например, {@code unavailable});</li>
 *     <li>{@code pismo:push} — пришло push-сообщение при живом приложении;</li>
 *     <li>{@code pismo:open} — приложение открыто по ссылке/уведомлению (чат/звонок).</li>
 * </ul>
 */
final class WebBridge {

    private static final String TAG = "PismoPush";

    private static WeakReference<WebView> webViewRef = new WeakReference<>(null);

    private WebBridge() {
    }

    static void attach(WebView webView) {
        webViewRef = new WeakReference<>(webView);
    }

    static void detach() {
        webViewRef = new WeakReference<>(null);
    }

    /** true, если веб-страница сейчас открыта и может принять событие. */
    static boolean isAttached() {
        return webViewRef.get() != null;
    }

    /** Отправляет в страницу DOM-событие {@code pismo:<event>} с JSON-деталями. */
    static void dispatch(String event, JSONObject detail) {
        if (webViewRef.get() == null) {
            return;
        }
        String script = "(function(){try{window.dispatchEvent(new CustomEvent('pismo:"
                + event
                + "',{detail:"
                + (detail == null ? "null" : detail.toString())
                + "}));}catch(e){}})()";
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                WebView current = webViewRef.get();
                if (current == null) {
                    return;
                }
                try {
                    current.evaluateJavascript(script, null);
                } catch (Exception exc) {
                    android.util.Log.w(TAG, "Не удалось отправить событие " + event, exc);
                }
            }
        });
    }

    /** Отдаёт в страницу новый push-токен (страница зарегистрирует его на сервере). */
    static void sendPushToken(String token) {
        JSONObject detail = new JSONObject();
        try {
            detail.put("token", token);
        } catch (Exception ignored) {
            // detail останется пустым — страница просто перезапросит токен
        }
        dispatch("rustore-token", detail);
    }

    /** Отдаёт в страницу данные push-сообщения (для мгновенного обновления UI). */
    static void sendPushData(Map<String, String> data) {
        JSONObject detail = new JSONObject();
        if (data != null) {
            for (Map.Entry<String, String> entry : data.entrySet()) {
                try {
                    detail.put(entry.getKey(), entry.getValue());
                } catch (Exception ignored) {
                    // ключи могут быть не-строками; пропускаем
                }
            }
        }
        dispatch("push", detail);
    }

    /** Сообщает странице, что push сейчас недоступны (нет RuStore/не авторизован). */
    static void sendPushStatus(String status, String reason) {
        JSONObject detail = new JSONObject();
        try {
            detail.put("status", status);
            if (reason != null) {
                detail.put("reason", reason);
            }
        } catch (Exception ignored) {
            // не критично
        }
        dispatch("push-status", detail);
    }

    /** Сообщает странице, что нужно открыть чат/звонок (клик по уведомлению). */
    static void sendOpenTarget(JSONObject detail) {
        dispatch("open", detail);
    }
}
