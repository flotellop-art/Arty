package com.arty.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.ResultReceiver;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;

/** Keeps user-initiated cloud generations eligible for network access on Android 16.
 * No requests are made here; process death never replays a billable operation. */
public class BackgroundGenerationService extends Service {
    private static final String CHANNEL = "arty_generation";
    private static final int NOTIFICATION = 7401;
    private static final long MAX_LEASE_MS = 10 * 60 * 1000L;
    private static BackgroundGenerationService current;
    private static final Set<String> pending = new HashSet<>();
    private int lastStartId;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Runnable> leases = new HashMap<>();
    private PowerManager.WakeLock wakeLock;

    @Override public void onCreate() {
        super.onCreate();
        current = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL,
                getString(R.string.generation_channel), NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent action = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_icon)
            .setContentTitle(getString(R.string.generation_title))
            .setContentText(getString(R.string.generation_body))
            .setContentIntent(action).setOngoing(true).setOnlyAlertOnce(true)
            .setSilent(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS).build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        lastStartId = startId;
        String token = intent == null ? null : intent.getStringExtra("token");
        pending.remove(token);
        @SuppressWarnings("deprecation")
        ResultReceiver receipt = intent == null ? null : intent.getParcelableExtra("receipt");
        if (token == null || receipt == null) {
            stopIfIdle();
            return START_NOT_STICKY;
        }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION, notification(),
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
            if (!leases.containsKey(token)) {
                Runnable expire = () -> {
                    BackgroundGenerationPlugin.expired(token);
                    release(token);
                };
                leases.put(token, expire);
                main.postDelayed(expire, MAX_LEASE_MS);
            }
            if (wakeLock == null) {
                wakeLock = getSystemService(PowerManager.class)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Arty:Generation");
                wakeLock.setReferenceCounted(false);
            }
            wakeLock.acquire(MAX_LEASE_MS);
            receipt.send(1, null);
        } catch (RuntimeException failure) {
            receipt.send(0, null);
            release(token);
        }
        return START_NOT_STICKY;
    }

    // Called on the main thread; releasing an old token never starts a service.
    static void starting(String token) { pending.add(token); }
    static void startFailed(String token) { pending.remove(token); release(token); }
    static void release(String token) {
        BackgroundGenerationService service = current;
        if (service == null) return;
        Runnable expiry = service.leases.remove(token);
        if (expiry != null) service.main.removeCallbacks(expiry);
        service.stopIfIdle();
    }

    private void stopIfIdle() {
        if (leases.isEmpty() && pending.isEmpty() && stopSelfResult(lastStartId)) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        }
    }

    @Override public void onTimeout(int startId, int fgsType) {
        for (String token : new ArrayList<>(leases.keySet())) BackgroundGenerationPlugin.expired(token);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        if (current == this) current = null;
        for (String token : new ArrayList<>(leases.keySet())) BackgroundGenerationPlugin.expired(token);
        for (Runnable expiry : leases.values()) main.removeCallbacks(expiry);
        leases.clear();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
