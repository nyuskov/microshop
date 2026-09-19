package space.pismo.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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

    /**
     * Больше этого размера присланный файл не читаем.
     *
     * Лимит загрузки на сервере — 15 МБ, и в WebView такой файл пришлось бы
     * держать в памяти страницы целиком: смысла нет, а падение получится обидное.
     */
    private static final int MAX_SHARE_BYTES = 20 * 1024 * 1024;

    private FrameLayout root;
    private WebView webView;
    private View errorView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingWebPermission;
    private JSONObject pendingOpenTarget;
    /** Расшифровка голосовых распознавателем устройства (создаётся по надобности). */
    private SpeechFileRecognizer speechRecognizer;

    /**
     * Замок для цели перехода: страница может забрать её сама из JS-потока
     * (см. {@code PismoNative.openTargetInfo}), а накопление идёт в UI-потоке.
     */
    private final Object openTargetLock = new Object();

    /** Содержимое системного «Поделиться» (ожидает выбора чата на странице). */
    private volatile SharedContent sharedContent;

    /** Байты присланного файла: читаются один раз, по запросу страницы. */
    private byte[] sharedBytes;

    /** Событие {@code pismo:share} уже отдано текущей странице. */
    private volatile boolean shareDelivered;

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

        // Разбираем интент ДО загрузки страницы: onPageFinished может сработать
        // раньше, чем мы успеем запомнить, куда идти и чем поделились.
        rememberOpenTarget(getIntent());
        rememberShare(getIntent());

        Uri launchUri = extractLaunchUri(getIntent());
        webView.loadUrl(launchUri != null ? launchUri.toString() : BuildConfig.BASE_URL);
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
        if (adoptShare(intent)) {
            // Приложение уже открыто — содержимое отдаём сразу, страница
            // предложит выбрать чат.
            shareDelivered = true;
            WebBridge.sendShare(shareDetail(sharedContent));
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
        if (speechRecognizer != null) {
            speechRecognizer.cancel();
        }
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
                WebBridge.sendOpenTarget(takePendingOpenTarget());
            }
            // Содержимое «Поделиться»: отдаём один раз (страница могла забрать
            // его сама через PismoNative.shareInfo() — тогда событие лишнее).
            shareDelivered = false;
            JSONObject share = pendingShareTarget();
            if (share != null) {
                shareDelivered = true;
                WebBridge.sendShare(share);
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
        setPendingOpenTarget(openTargetOf(intent));
    }

    private void setPendingOpenTarget(JSONObject target) {
        synchronized (openTargetLock) {
            pendingOpenTarget = target;
        }
    }

    /** Забирает цель перехода один раз (второй раз уже некому отдавать). */
    private JSONObject takePendingOpenTarget() {
        synchronized (openTargetLock) {
            JSONObject target = pendingOpenTarget;
            pendingOpenTarget = null;
            return target;
        }
    }

    // ------------------------------------------------------------------ «Поделиться»

    /** Содержимое системного «Поделиться»: текст и/или один файл. */
    private static final class SharedContent {
        final String text;
        final String subject;
        final String mime;
        final String name;
        final Uri uri;
        final long size;

        SharedContent(
                String text, String subject, String mime, String name, Uri uri, long size) {
            this.text = text;
            this.subject = subject;
            this.mime = mime;
            this.name = name;
            this.uri = uri;
            this.size = size;
        }
    }

    /** Запоминает содержимое «Поделиться» при холодном старте (отдадим после загрузки). */
    private void rememberShare(Intent intent) {
        sharedContent = null;
        sharedBytes = null;
        shareDelivered = false;
        adoptShare(intent);
    }

    /** Принимает содержимое «Поделиться»: {@code true} — если в интенте есть что отдавать. */
    private boolean adoptShare(Intent intent) {
        SharedContent content = sharedContentOf(intent);
        if (content == null) {
            return false;
        }
        sharedContent = content;
        // Новое содержимое — прежние байты больше не нужны.
        sharedBytes = null;
        return true;
    }

    /** Что ещё не отдано странице; {@code null} — нечего отдавать. */
    private JSONObject pendingShareTarget() {
        if (sharedContent == null || shareDelivered) {
            return null;
        }
        return shareDetail(sharedContent);
    }

    /** Описание содержимого «Поделиться» для страницы. */
    private JSONObject shareDetail(SharedContent content) {
        JSONObject detail = new JSONObject();
        try {
            detail.put("text", content.text);
            detail.put("subject", content.subject);
            detail.put("mime", content.mime);
            detail.put("name", content.name);
            detail.put("size", content.size);
            detail.put("hasFile", content.uri != null);
        } catch (Exception ignored) {
            // значения — строки и число, ошибка возможна только теоретически
        }
        return detail;
    }

    /** Разбирает интент «Поделиться»; {@code null} — если это не он или делиться нечем. */
    private SharedContent sharedContentOf(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return null;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String mime = intent.getType();
        Uri uri = streamUriOf(intent);
        boolean hasText = text != null && !text.trim().isEmpty();
        if (uri == null && !hasText) {
            return null;
        }
        String name = "";
        long size = 0;
        if (uri != null) {
            name = displayNameOf(uri);
            size = sizeOf(uri);
            if (mime == null || mime.isEmpty()) {
                mime = getContentResolver().getType(uri);
            }
        }
        return new SharedContent(
                text == null ? "" : text,
                subject == null ? "" : subject,
                mime == null ? "" : mime,
                name,
                uri,
                size);
    }

    /** Uri присланного файла (EXTRA_STREAM или первый элемент ClipData). */
    @SuppressWarnings("deprecation")
    private Uri streamUriOf(Intent intent) {
        Uri uri;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        } else {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null && intent.getClipData() != null
                && intent.getClipData().getItemCount() > 0) {
            uri = intent.getClipData().getItemAt(0).getUri();
        }
        return uri;
    }

    /** Имя присланного файла из системного провайдера. */
    private String displayNameOf(Uri uri) {
        try (Cursor cursor = getContentResolver()
                .query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0 && !cursor.isNull(index)) {
                    String name = cursor.getString(index);
                    if (name != null && !name.isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception exc) {
            Log.w(TAG, "Не удалось узнать имя присланного файла", exc);
        }
        String fallback = uri.getLastPathSegment();
        return fallback == null ? "" : fallback;
    }

    /** Размер присланного файла (0 — провайдер его не сообщил). */
    private long sizeOf(Uri uri) {
        try (Cursor cursor = getContentResolver()
                .query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0 && !cursor.isNull(index)) {
                    return cursor.getLong(index);
                }
            }
        } catch (Exception exc) {
            Log.w(TAG, "Не удалось узнать размер присланного файла", exc);
        }
        return 0;
    }

    /**
     * Читает присланный файл целиком (один раз — дальше отдаёт из памяти).
     *
     * Вызывается из JS-потока WebView (методы {@code @JavascriptInterface}
     * выполняются не в UI-потоке), поэтому чтение здесь не блокирует интерфейс.
     */
    private synchronized byte[] readSharedBytes() {
        if (sharedBytes != null) {
            return sharedBytes;
        }
        SharedContent content = sharedContent;
        if (content == null || content.uri == null) {
            return null;
        }
        if (content.size > MAX_SHARE_BYTES) {
            return null;
        }
        try (InputStream input = getContentResolver().openInputStream(content.uri)) {
            if (input == null) {
                return null;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_SHARE_BYTES) {
                    Log.w(TAG, "Присланный файл больше лимита — пропускаем");
                    return null;
                }
                out.write(buffer, 0, read);
            }
            sharedBytes = out.toByteArray();
            return sharedBytes;
        } catch (Exception exc) {
            Log.w(TAG, "Не удалось прочитать присланный файл", exc);
            return null;
        }
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
        for (String key : new String[]{"type", "chat_id", "message_id", "peer_id", "call_id",
                "action"}) {
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

        /**
         * Описание содержимого из системного «Поделиться» (JSON) или пустая
         * строка. Страница зовёт это сама как страховку: событие {@code pismo:share}
         * могло прийти раньше, чем она успела подписаться.
         */
        @JavascriptInterface
        public String shareInfo() {
            SharedContent content = sharedContent;
            if (content == null) {
                return "";
            }
            // Страница забрала содержимое сама — событие ей уже не нужно.
            shareDelivered = true;
            return shareDetail(content).toString();
        }

        /**
         * Кусок присланного файла в base64.
         *
         * Частями, а не целиком: вызов JS из нативной части ограничен по размеру,
         * и большая картинка одним куском не пролезла бы.
         */
        @JavascriptInterface
        public String readShareChunk(int offset, int length) {
            byte[] data = readSharedBytes();
            if (data == null || offset < 0 || offset >= data.length) {
                return "";
            }
            int count = Math.min(Math.max(length, 1), data.length - offset);
            return Base64.encodeToString(data, offset, count, Base64.NO_WRAP);
        }

        /** Страница закончила с содержимым (отправила или отменила). */
        @JavascriptInterface
        public void clearShare() {
            sharedContent = null;
            sharedBytes = null;
        }

        /**
         * Цель перехода из уведомления (чат или звонок) в JSON или пустая строка.
         * Страница зовёт это сама при старте: событие {@code pismo:open} может
         * обогнать подписку на него — тогда холодный старт по «Ответить» терял
         * действие, и звонок приходилось принимать вручную.
         */
        @JavascriptInterface
        public String openTargetInfo() {
            JSONObject target = takePendingOpenTarget();
            return target == null ? "" : target.toString();
        }

        // ----------------------------------------- расшифровка голосовых (F4)

        /**
         * Умеет ли устройство распознавать ЗАПИСЬ (Android 13+ и есть сервис
         * распознавания). Страница по этому ответу показывает кнопку «В текст».
         */
        @JavascriptInterface
        public boolean speechSupported() {
            return speech().isSupported();
        }

        /**
         * Начало расшифровки: готовимся принять звук одного голосового.
         *
         * @param id       идентификатор сообщения (вернётся в событии)
         * @param language язык распознавания (`ru-RU` и т.п.)
         */
        @JavascriptInterface
        public boolean speechBegin(String id, String language) {
            return speech().begin(id, language);
        }

        /**
         * Кусок звука: PCM 16 бит, моно, 16 кГц, в base64. Последний кусок
         * (`last`) запускает распознавание; результат придёт событием
         * {@code pismo:speech}.
         */
        @JavascriptInterface
        public void speechChunk(String base64, boolean last) {
            speech().chunk(base64, last);
        }

        /** Отмена расшифровки (человек закрыл текст, ушёл из чата). */
        @JavascriptInterface
        public void speechCancel() {
            speech().cancel();
        }
    }

    /** Распознаватель записей: один на активность, создаётся при первой нужде. */
    private SpeechFileRecognizer speech() {
        if (speechRecognizer == null) {
            speechRecognizer = new SpeechFileRecognizer(this);
        }
        return speechRecognizer;
    }
}
