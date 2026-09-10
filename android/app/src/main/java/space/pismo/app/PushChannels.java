package space.pismo.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;

/**
 * Каналы уведомлений.
 *
 * Их должно создавать само приложение: RuStore Push только доставляет данные и
 * показывает уведомление в указанном канале ({@code channel_id}).
 * <ul>
 *     <li>{@code pismo_messages} — сообщения (канал по умолчанию);</li>
 *     <li>{@code pismo_calls} — входящие звонки: высокий приоритет, вибрация и
 *     звук, чтобы работало как «будильник» при свёрнутом приложении.</li>
 * </ul>
 */
final class PushChannels {

    static final String MESSAGES = "pismo_messages";
    static final String CALLS = "pismo_calls";

    private PushChannels() {
    }

    /** Создаёт каналы (идемпотентно). */
    static void ensure(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }

        CharSequence appName = context.getString(R.string.app_name);

        NotificationChannel messages = new NotificationChannel(
                MESSAGES,
                appName,
                NotificationManager.IMPORTANCE_DEFAULT);
        messages.setDescription(context.getString(R.string.push_channel_messages_desc));
        manager.createNotificationChannel(messages);

        NotificationChannel calls = new NotificationChannel(
                CALLS,
                appName + " — " + context.getString(R.string.push_channel_calls_title),
                NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription(context.getString(R.string.push_channel_calls_desc));
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[]{0, 400, 250, 400, 250, 400});
        calls.setSound(
                android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
                new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .build());
        manager.createNotificationChannel(calls);
    }
}
