package space.pismo.app;

import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;

/**
 * Расшифровка ГОТОВОЙ записи голосового — распознавателем самого устройства.
 *
 * Почему так, а не Web Speech: в WebView API распознавания речи НЕТ вовсе, поэтому
 * в приложении кнопки «В текст» не было. Здесь страница отдаёт нам звук, а мы
 * отдаём его системному распознавателю как файл
 * ({@link RecognizerIntent#EXTRA_AUDIO_SOURCE}, Android 13+).
 *
 * Формат: распознавателю нужен НЕ контейнер (wav/ogg), а «сырой» поток PCM — 16
 * бит, моно, 16 кГц. Поэтому страница декодирует запись и присылает PCM в base64
 * кусками: одним вызовом большой файл не пролезет, у вызова JS из нативной части
 * есть предел по размеру.
 *
 * Потоки: методы зовёт JS-поток WebView (методы {@code @JavascriptInterface}
 * выполняются не в UI-потоке), а распознаватель обязан создаваться и работать в
 * потоке с Looper — поэтому все обращения к нему идут через главный поток, а
 * буфер звука защищён {@code synchronized}.
 *
 * Звук уходит по сети только если распознавателя «на устройстве» в системе нет:
 * тогда используется обычный системный (это решение системы, а не наше).
 */
final class SpeechFileRecognizer {

    private static final String TAG = "PismoSpeech";

    /** Сколько PCM принимаем: 5 минут моно 16 кГц — это ~9.6 МБ, дальше отказ. */
    private static final int MAX_PCM_BYTES = 12 * 1024 * 1024;

    /** Частота, которую распознаватель ждёт по умолчанию. */
    private static final int SAMPLE_RATE = 16000;

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    /** Текст по сегментам: длинная запись приходит несколькими частями. */
    private final StringBuilder segments = new StringBuilder();
    private String sessionId = "";
    private String language = "ru-RU";
    private SpeechRecognizer recognizer;
    private File pcmFile;

    SpeechFileRecognizer(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Можно ли распознавать файл на этом устройстве (нужен Android 13). */
    boolean isSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && SpeechRecognizer.isRecognitionAvailable(context);
    }

    /** Начинает приём звука для новой расшифровки. */
    boolean begin(String id, String lang) {
        cancel();
        if (!isSupported()) {
            return false;
        }
        sessionId = id == null ? "" : id;
        language = lang == null || lang.isEmpty() ? "ru-RU" : lang;
        synchronized (this) {
            buffer.reset();
            segments.setLength(0);
        }
        return true;
    }

    /** Кусок звука (base64). Последний кусок запускает распознавание. */
    void chunk(String base64, boolean last) {
        if (base64 != null && !base64.isEmpty()) {
            byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (Exception exc) {
                Log.w(TAG, "Не удалось разобрать кусок звука", exc);
                fail("Не удалось подготовить звук");
                return;
            }
            synchronized (this) {
                if (buffer.size() + bytes.length > MAX_PCM_BYTES) {
                    fail("Запись слишком длинная для расшифровки");
                    return;
                }
                buffer.write(bytes, 0, bytes.length);
            }
        }
        if (last) {
            startRecognition();
        }
    }

    /** Останавливает распознавание и убирает временный файл. */
    void cancel() {
        synchronized (this) {
            buffer.reset();
            segments.setLength(0);
        }
        post(new Runnable() {
            @Override
            public void run() {
                release();
            }
        });
    }

    // --------------------------------------------------------------- внутреннее

    private void post(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
        } else {
            main.post(action);
        }
    }

    /** Освобождает распознаватель и временный файл (главный поток). */
    private void release() {
        if (recognizer != null) {
            try {
                recognizer.cancel();
                recognizer.destroy();
            } catch (Exception exc) {
                Log.w(TAG, "Не удалось остановить распознавание", exc);
            }
            recognizer = null;
        }
        if (pcmFile != null) {
            //noinspection ResultOfMethodCallIgnored
            pcmFile.delete();
            pcmFile = null;
        }
    }

    /** Пишет звук в файл и отдаёт его распознавателю. */
    private void startRecognition() {
        final byte[] pcm;
        synchronized (this) {
            pcm = buffer.toByteArray();
            buffer.reset();
        }
        if (pcm.length == 0) {
            fail("Распознавание не получило звук");
            return;
        }
        final File target = new File(context.getCacheDir(), "stt-" + sessionId + ".pcm");
        try {
            try (FileOutputStream out = new FileOutputStream(target)) {
                out.write(pcm);
            }
        } catch (Exception exc) {
            Log.w(TAG, "Не удалось сохранить звук для распознавания", exc);
            fail("Не удалось подготовить звук");
            return;
        }
        pcmFile = target;
        post(new Runnable() {
            @Override
            public void run() {
                listen(target);
            }
        });
    }

    /** Запуск распознавания по файлу (главный поток). */
    private void listen(File source) {
        try {
            ParcelFileDescriptor descriptor =
                    ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY);
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            // Частичные результаты — чтобы страница показывала текст по мере чтения.
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, descriptor);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
            intent.putExtra(
                    RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING,
                    AudioFormat.ENCODING_PCM_16BIT);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, SAMPLE_RATE);

            recognizer = createRecognizer();
            recognizer.setRecognitionListener(new Listener());
            recognizer.startListening(intent);
        } catch (Exception exc) {
            Log.w(TAG, "Не удалось начать распознавание", exc);
            fail("Распознавание недоступно на этом устройстве");
        }
    }

    /**
     * Распознаватель: сначала «на устройстве» (работает без сети), иначе — обычный
     * системный.
     */
    private SpeechRecognizer createRecognizer() {
        if (SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
            return SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
        }
        return SpeechRecognizer.createSpeechRecognizer(context);
    }

    /** Отправляет результат в страницу (DOM-событие {@code pismo:speech}). */
    private void send(String status, String text, String error) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("id", sessionId);
            detail.put("status", status);
            detail.put("text", text == null ? "" : text);
            if (error != null) {
                detail.put("error", error);
            }
            WebBridge.dispatch("speech", detail);
        } catch (Exception exc) {
            Log.w(TAG, "Не удалось отправить результат распознавания", exc);
        }
    }

    /** Завершает прогон с ошибкой (текста нет). */
    private void fail(String message) {
        cancel();
        send("failed", "", message);
    }

    /** Код ошибки распознавателя — в слова, которые понимает страница. */
    private static String errorCode(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-speech";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "network";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "not-allowed";
            case SpeechRecognizer.ERROR_CLIENT:
                return "aborted";
            default:
                return "other";
        }
    }

    /** Самый уверенный вариант из ответа распознавателя. */
    private static String best(ArrayList<String> results, float[] scores) {
        if (results == null || results.isEmpty()) {
            return "";
        }
        int bestIndex = 0;
        if (scores != null && scores.length == results.size()) {
            for (int index = 1; index < results.size(); index++) {
                if (scores[index] > scores[bestIndex]) {
                    bestIndex = index;
                }
            }
        }
        String text = results.get(bestIndex);
        return text == null ? "" : text.trim();
    }

    /** Собранный по сегментам текст. */
    private String collected() {
        synchronized (this) {
            return segments.toString().trim();
        }
    }

    /** Колбэки распознавателя: превращаем их в события для страницы. */
    private final class Listener implements RecognitionListener {

        private void addSegment(String text) {
            if (text == null || text.isEmpty()) {
                return;
            }
            synchronized (SpeechFileRecognizer.this) {
                if (segments.length() > 0) {
                    segments.append(' ');
                }
                segments.append(text.trim());
            }
        }

        @Override
        public void onSegmentResults(Bundle results) {
            // Длинная запись приходит по частям: без сборки сегментов остался бы
            // только последний кусок.
            addSegment(best(
                    results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION),
                    results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)));
        }

        @Override
        public void onPartialResults(Bundle partial) {
            String text = best(
                    partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION),
                    partial.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES));
            String already = collected();
            String shown = text.isEmpty()
                    ? already
                    : (already.isEmpty() ? text : already + " " + text);
            if (!shown.isEmpty()) {
                send("partial", shown, null);
            }
        }

        @Override
        public void onResults(Bundle results) {
            String text = best(
                    results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION),
                    results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES));
            String already = collected();
            if (text.isEmpty()) {
                text = already;
            } else if (!already.isEmpty() && !already.endsWith(text)) {
                // Сегменты уже собраны, а финальный результат — лишь последний
                // кусок: дописываем только то, чего в сборке нет.
                text = already + " " + text;
            }
            cancel();
            if (text.trim().isEmpty()) {
                send("failed", "", "Речь не разобрана — возможно, в записи тихо или шумно");
                return;
            }
            send("ready", text.trim(), null);
        }

        @Override
        public void onError(int error) {
            String text = collected();
            cancel();
            // Текст успел прийти — отдаём его, а не ошибку: человеку важен текст.
            if (!text.isEmpty()) {
                send("ready", text, null);
                return;
            }
            send("failed", "", errorCode(error));
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            // Ничего: страница уже знает, что распознавание идёт.
        }

        @Override
        public void onBeginningOfSpeech() {
            // Ничего.
        }

        @Override
        public void onRmsChanged(float rmsdB) {
            // Ничего: уровень звука в интерфейсе не показываем.
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
            // Ничего.
        }

        @Override
        public void onEndOfSpeech() {
            // Ничего: страница ждёт итог.
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
            // Ничего.
        }
    }
}
