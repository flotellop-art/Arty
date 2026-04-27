package com.arty.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Captures widget-launched intents (ACTION_OPEN_FROM_WIDGET broadcast by
// ArtyWidgetProvider) and exposes them to JS. Mirrors ShareTargetPlugin:
// the launching intent is consumed at load() (cold start) or via
// handleNewIntent() (warm start, singleTask reuses MainActivity).
@CapacitorPlugin(name = "WidgetIntent")
public class WidgetIntentPlugin extends Plugin {

    private final Object lock = new Object();
    private JSObject pendingAction = null;

    @Override
    public void load() {
        Intent intent = getActivity().getIntent();
        if (intent != null) consumeIntent(intent, false);
    }

    public void handleNewIntent(Intent intent) {
        if (intent == null) return;
        consumeIntent(intent, true);
    }

    @PluginMethod
    public void getPendingAction(PluginCall call) {
        synchronized (lock) {
            JSObject payload = pendingAction;
            pendingAction = null;
            if (payload == null) {
                JSObject empty = new JSObject();
                empty.put("source", JSObject.NULL);
                empty.put("action", JSObject.NULL);
                call.resolve(empty);
            } else {
                call.resolve(payload);
            }
        }
    }

    private void consumeIntent(Intent intent, boolean emitEvent) {
        if (!ArtyWidgetProvider.ACTION_OPEN_FROM_WIDGET.equals(intent.getAction())) return;

        String source = intent.getStringExtra(ArtyWidgetProvider.EXTRA_WIDGET_SOURCE);
        if (source == null) source = "unknown";

        JSObject payload = new JSObject();
        payload.put("source", source);
        payload.put("action", "open_chat"); // V1: just open. V1.5: include "prompt" key.

        synchronized (lock) {
            pendingAction = payload;
        }
        if (emitEvent) {
            notifyListeners("widgetAction", payload);
        }
    }
}
