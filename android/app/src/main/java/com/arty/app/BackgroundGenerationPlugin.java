package com.arty.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import java.util.HashSet;
import java.util.Set;
import androidx.core.content.ContextCompat;

@CapacitorPlugin(name = "BackgroundGeneration")
public class BackgroundGenerationPlugin extends Plugin {
    private static WeakReference<BackgroundGenerationPlugin> current = new WeakReference<>(null);
    private final Set<String> owned = new HashSet<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean destroyed;

    @Override public void load() { current = new WeakReference<>(this); }

    @PluginMethod public void acquire(PluginCall call) {
        String token = call.getString("token", "");
        if (!token.matches("[a-fA-F0-9-]{36}")) { call.reject("Invalid generation lease"); return; }
        main.post(() -> {
            if (destroyed) { call.reject("Generation view closed"); return; }
            owned.add(token);
            // Resolve only when the service has actually called startForeground.
            ResultReceiver receipt = new ResultReceiver(main) {
                @Override protected void onReceiveResult(int result, Bundle data) {
                    if (destroyed || !owned.contains(token)) {
                        BackgroundGenerationService.release(token);
                        call.reject("Generation cancelled");
                    } else if (result == 1) {
                        call.resolve();
                    } else {
                        owned.remove(token);
                        call.reject("Background generation unavailable");
                    }
                }
            };
            Intent intent = new Intent(getContext(), BackgroundGenerationService.class)
                .putExtra("token", token).putExtra("receipt", receipt);
            BackgroundGenerationService.starting(token);
            try { ContextCompat.startForegroundService(getContext(), intent); }
            catch (RuntimeException error) {
                BackgroundGenerationService.startFailed(token);
                owned.remove(token);
                call.reject("Background generation unavailable");
            }
        });
    }

    @PluginMethod public void release(PluginCall call) {
        String token = call.getString("token", "");
        main.post(() -> {
            owned.remove(token);
            BackgroundGenerationService.release(token);
            call.resolve();
        });
    }

    static void expired(String token) {
        BackgroundGenerationPlugin plugin = current.get();
        if (plugin == null || plugin.destroyed || !plugin.owned.remove(token)) return;
        JSObject event = new JSObject(); event.put("token", token);
        plugin.notifyListeners("expired", event);
    }

    @Override protected void handleOnDestroy() {
        main.post(() -> {
            destroyed = true;
            for (String token : new HashSet<>(owned)) BackgroundGenerationService.release(token);
            owned.clear();
        });
        super.handleOnDestroy();
    }
}
