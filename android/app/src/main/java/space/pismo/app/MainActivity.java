package space.pismo.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import ru.rustore.sdk.core.tasks.OnFailureListener;
import ru.rustore.sdk.core.tasks.OnSuccessListener;
import ru.rustore.sdk.pushclient.RuStorePushClient;

/**
 * Оболочка мессенджера Pismo.
 *
 * Внутри — тот же самый веб-клиент (https://pismo.space), что и в браузере,
 * поэтому веб-версия и мобильное приложение всегда синхронны. Нативная часть
 * отвечает за то, чего нет в WebView: разрешения (камера/микрофон), выбор
 * файлов, ссылки/уведомления, push-уведомления RuStore и экран «нет сети».
 *
 * Связь с веб-страницей — DOM-события {@code pismo:*} (см. {@link WebBridge}) и
 * объект {@code window.PismoNative} (см. {@link NativeBridge}).
 */
public class MainActivity extends Activity {

    private static final String TAG = "Pismo";
    private static final String PUSH_ACTION = "space.pismo.app.PUSH";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_WEB_PERMISSIONS = 1002;
    private static final int REQ_NOTIFICATIONS = 1003;

    private FrameLayout root;
    private WebView webView;
    private View errorView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingWebPermission;
    private JSONObject pendingOpenTarget;

    // ------------------------------------------------------------------ жизненный цикл

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PushChannels.ensure(this);

        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.pismo_background));
        setContentView(root);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        createWebView();
        WebBridge.attach(webView);

        Uri launchUri = extractLaunchUri(getIntent());
        webView.loadUrl(launchUri != null ? launchUri.toString() : BuildConfig.BASE_URL);
        rememberOpenTarget(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri uri = extractLaunchUri(intent);
        if (uri != null && webView != null) {
            webView.loadUrl(uri.toString());
        }
        JSONObject target = openTargetOf(intent);
        if (target != null) {
            // Приложение уже открыто — сразу отдаём событие странице.
            WebBridge.sendOpenTarget(target);
        }
    }

    @Override
    public void onBackPressed() {
        if (errorView != null) {
            hideError();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        WebBridge.detach();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------ WebView

    private void createWebView() {
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Звонок должен «звонить» без клика пользователя (иначе автоответчик не сработает).
        settings.setMediaPlaybackRequiresUserGesture(false);
        // Метка в UA: по ней веб-клиент понимает, что открыт в нативном приложении,
        // и включает RuStore Push вместо Web Push.
        settings.setUserAgentString(
                settings.getUserAgentString() + " PismoAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);

        webView.setWebViewClient(new PismoWebViewClient());
        webView.setWebChromeClient(new PismoChromeClient());
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(
                    String url, String userAgent, String disposition, String mime, long length) {
                openInBrowser(Uri.parse(url));
            }
        });
        webView.addJavascriptInterface(new NativeBridge(), "PismoNative");

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private class PismoWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            if ("http".equals(scheme) || "https".equals(scheme)) {
                String host = uri.getHost();
                String baseHost = Uri.parse(BuildConfig.BASE_URL).getHost();
                // Свои страницы — внутри приложения, чужие (в т.ч. оферты/политики
                // сторонних сервисов) — в системном браузере.
                if (host != null && baseHost != null
                        && (host.equals(baseHost) || host.endsWith("." + baseHost))) {
                    return false;
                }
                openInBrowser(uri);
                return true;
            }
            if ("mailto".equals(scheme) || "tel".equals(scheme) || "sms".equals(scheme)) {
                openInBrowser(uri);
                return true;
            }
            return false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            // Страница готова — можно отдавать накопленный push-токен и цель перехода.
            String token = PushTokenStore.get(MainActivity.this);
            if (!token.isEmpty()) {
                WebBridge.sendPushToken(token);
            }
            if (pendingOpenTarget != null) {
                WebBridge.sendOpenTarget(pendingOpenTarget);
                pendingOpenTarget = null;
            }
            WebBridge.dispatch("page-ready", null);
        }

        @Override
        public void onReceivedError(
                WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                Log.w(TAG, "Ошибка загрузки главного фрейма: " + error.getDescription());
                showError();
            }
        }
    }

    private class PismoChromeClient extends WebChromeClient {

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            List<String> missing = new ArrayList<>();
            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                        && !hasPermission(Manifest.permission.CAMERA)) {
                    missing.add(Manifest.permission.CAMERA);
                } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                        && !hasPermission(Manifest.permission.RECORD_AUDIO)) {
                    missing.add(Manifest.permission.RECORD_AUDIO);
                }
            }
            if (missing.isEmpty()) {
                request.grant(request.getResources());
                return;
            }
            pendingWebPermission = request;
            requestPermissions(missing.toArray(new String[0]), REQ_WEB_PERMISSIONS);
        }

        @Override
        public boolean onShowFileChooser(
                WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;
            try {
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(
                        Intent.createChooser(intent, getString(R.string.choose_file)),
                        REQ_FILE_CHOOSER);
                return true;
            } catch (ActivityNotFoundException exc) {
                Log.w(TAG, "Не найден файловый менеджер", exc);
                filePathCallback = null;
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_WEB_PERMISSIONS && pendingWebPermission != null) {
            boolean granted = grantResults.length > 0;
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    granted = false;
                    break;
                }
            }
            if (granted) {
                pendingWebPermission.grant(pendingWebPermission.getResources());
            } else {
                pendingWebPermission.deny();
                Toast.makeText(this, R.string.permission_denied, Toast.LENGTH_LONG).show();
            }
            pendingWebPermission = null;
            return;
        }
        if (requestCode == REQ_NOTIFICATIONS) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            WebBridge.sendPushStatus(granted ? "granted" : "denied", null);
        }
    }

    // ------------------------------------------------------------------ экран «нет сети»

    private void showError() {
        if (errorView != null) {
            return;
        }
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(android.view.Gravity.CENTER);
        layout.setBackgroundColor(getColor(R.color.pismo_background));
        int padding = (int) (getResources().getDisplayMetrics().density * 24);
        layout.setPadding(padding, padding, padding, padding);

        TextView title = new TextView(this);
        title.setText(R.string.offline_title);
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(20f);
        title.setGravity(android.view.Gravity.CENTER);
        layout.addView(title);

        TextView hint = new TextView(this);
        hint.setText(R.string.offline_hint);
        hint.setTextColor(0xFFB9C2CC);
        hint.setTextSize(15f);
        hint.setGravity(android.view.Gravity.CENTER);
        hint.setPadding(0, padding / 3, 0, padding / 2);
        layout.addView(hint);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideError();
            }
        });
        layout.addView(retry);

        errorView = layout;
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (webView != null) {
            webView.setVisibility(View.GONE);
        }
    }

    private void hideError() {
        if (errorView == null) {
            return;
        }
        root.removeView(errorView);
        errorView = null;
        if (webView != null) {
            webView.setVisibility(View.VISIBLE);
            if (webView.getUrl() == null) {
                webView.loadUrl(BuildConfig.BASE_URL);
            } else {
                webView.reload();
            }
        }
    }

    // ------------------------------------------------------------------ push RuStore

    /** Запрашивает push-токен RuStore и отдаёт его веб-странице. */
    void refreshPushToken() {
        if (BuildConfig.RUSTORE_PROJECT_ID == null || BuildConfig.RUSTORE_PROJECT_ID.isEmpty()) {
            Log.w(TAG, "RUSTORE_PROJECT_ID не задан при сборке — push отключены");
            WebBridge.sendPushStatus("disabled", "project_id не задан");
            return;
        }
        RuStorePushClient.INSTANCE.getToken()
                .addOnSuccessListener(new OnSuccessListener<String>() {
                    @Override
                    public void onSuccess(String token) {
                        PushTokenStore.save(MainActivity.this, token);
                        WebBridge.sendPushToken(token);
                    }
                })
                .addOnFailureListener(new OnFailureListener() {
                    @Override
                    public void onFailure(Throwable throwable) {
                        Log.w(TAG, "Push-токен RuStore недоступен", throwable);
                        WebBridge.sendPushStatus(
                                "unavailable", throwable.getClass().getSimpleName());
                    }
                });
    }

    private boolean isNotificationPermissionGranted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true;
        }
        return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void requestNotificationsPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && !isNotificationPermissionGranted()) {
            requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }
    }

    // ------------------------------------------------------------------ утилиты

    private boolean hasPermission(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void openInBrowser(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException exc) {
            Log.w(TAG, "Нет приложения для " + uri, exc);
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        }
    }

    /** Ссылка запуска (App Link/Deep link на свой домен) или {@code null}. */
    private Uri extractLaunchUri(Intent intent) {
        if (intent == null || intent.getData() == null) {
            return null;
        }
        Uri data = intent.getData();
        if (!"https".equals(data.getScheme())) {
            return null;
        }
        String host = data.getHost();
        String baseHost = Uri.parse(BuildConfig.BASE_URL).getHost();
        if (host == null || baseHost == null) {
            return null;
        }
        if (host.equals(baseHost) || host.endsWith("." + baseHost)) {
            return data;
        }
        return null;
    }

    /** Сохраняет цель перехода из push, чтобы отдать её странице после загрузки. */
    private void rememberOpenTarget(Intent intent) {
        pendingOpenTarget = openTargetOf(intent);
    }

    /** Данные push-уведомления (чат/звонок) из интента или {@code null}. */
    private JSONObject openTargetOf(Intent intent) {
        if (intent == null) {
            return null;
        }
        if (intent.getAction() != null && !PUSH_ACTION.equals(intent.getAction())
                && intent.getData() == null) {
            return null;
        }
        JSONObject detail = new JSONObject();
        boolean hasData = false;
        for (String key : new String[]{"type", "chat_id", "message_id", "peer_id", "call_id"}) {
            String value = intent.getStringExtra(key);
            if (value != null && !value.isEmpty()) {
                try {
                    detail.put(key, value);
                    hasData = true;
                } catch (Exception ignored) {
                    // некорректное значение — пропускаем
                }
            }
        }
        return hasData ? detail : null;
    }

    // ------------------------------------------------------------------ мост в JS

    /** Объект {@code window.PismoNative} для веб-страницы. */
    public class NativeBridge {

        @JavascriptInterface
        public String getPlatform() {
            return "android";
        }

        @JavascriptInterface
        public String getAppVersion() {
            return BuildConfig.VERSION_NAME;
        }

        /** Ранее полученный push-токен (пустая строка, если его ещё нет). */
        @JavascriptInterface
        public String getPushToken() {
            return PushTokenStore.get(MainActivity.this);
        }

        /** Попросить нативный слой заново получить push-токен (в т.ч. разрешение). */
        @JavascriptInterface
        public void requestPushToken() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    requestNotificationsPermission();
                    refreshPushToken();
                }
            });
        }

        @JavascriptInterface
        public void requestNotificationsPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.requestNotificationsPermission();
                }
            });
        }

        @JavascriptInterface
        public boolean isNotificationPermissionGranted() {
            return MainActivity.this.isNotificationPermissionGranted();
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openInBrowser(Uri.parse(url));
                }
            });
        }
    }
}
