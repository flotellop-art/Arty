package com.arty.app;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.annotation.ActivityCallback;

/** Only control/status crosses Capacitor. No API can return SMS content to JS. */
@CapacitorPlugin(name = "LocalSms", permissions = {
    @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS })
})
public class LocalSmsPlugin extends Plugin {
    private final LocalSmsSession session = LocalSmsSession.INSTANCE;
    private PluginCall pendingConsent;
    private AlertDialog disclosure;
    private boolean osPermissionPending;
    private boolean inboxOpen;

    @PluginMethod public void startSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String token = call.getString("token");
            if (!BuildConfig.LOCAL_SMS_ENABLED || token == null || !token.matches("[a-zA-Z0-9-]{16,80}")) {
                call.reject("sms_unavailable"); return;
            }
            cancelDisclosure();
            session.start(token);
            resolveStatus(call);
        });
    }
    @PluginMethod public void endSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String token = call.getString("token");
            session.end(token);
            if (pendingConsent != null && token != null && token.equals(pendingConsent.getString("token"))) cancelDisclosure();
            call.resolve();
        });
    }
    @PluginMethod public void getStatus(PluginCall call) {
        getActivity().runOnUiThread(() -> resolveStatus(call));
    }
    @PluginMethod public void revokeAccess(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!session.current(call.getString("token"))) { call.reject("sms_cancelled"); return; }
            session.decide(call.getString("token"), LocalSmsSession.Decision.DECLINED);
            cancelDisclosure();
            resolveStatus(call);
        });
    }
    @PluginMethod public void requestAccess(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String token = call.getString("token");
            if (!session.current(token) || !BuildConfig.LOCAL_SMS_ENABLED) { call.reject("sms_cancelled"); return; }
            if (pendingConsent != null || osPermissionPending) { call.reject("sms_busy"); return; }
            pendingConsent = call;
            disclosure = new AlertDialog.Builder(getActivity())
                .setTitle(getContext().getString(R.string.sms_consent_title))
                .setMessage(getContext().getString(R.string.sms_consent_body))
                .setNegativeButton(R.string.sms_decline, (dialog, which) -> {
                    session.decide(token, LocalSmsSession.Decision.DECLINED);
                    pendingConsent = null; disclosure = null; resolveStatus(call);
                })
                .setPositiveButton(R.string.sms_allow, (dialog, which) -> {
                    disclosure = null;
                    if (pendingConsent != call || !session.current(token)) { call.reject("sms_cancelled"); return; }
                    if (hasPermission()) completePermission(call);
                    else {
                        try { osPermissionPending = true; requestPermissionForAlias("sms", call, "smsPermissionResult"); }
                        catch (RuntimeException error) {
                            osPermissionPending = false;
                            pendingConsent = null;
                            session.decide(token, LocalSmsSession.Decision.DECLINED);
                            call.reject("sms_unavailable");
                        }
                    }
                })
                .setOnCancelListener(dialog -> {
                    session.decide(token, LocalSmsSession.Decision.DECLINED);
                    pendingConsent = null; disclosure = null; resolveStatus(call);
                }).create();
            disclosure.show();
        });
    }
    @PermissionCallback private void smsPermissionResult(PluginCall call) {
        getActivity().runOnUiThread(() -> { osPermissionPending = false; completePermission(call); });
    }
    private void completePermission(PluginCall call) {
        if (pendingConsent != call || !session.current(call.getString("token"))) {
            if (pendingConsent == call) pendingConsent = null;
            call.reject("sms_cancelled"); return;
        }
        pendingConsent = null;
        session.decide(call.getString("token"), hasPermission() ? LocalSmsSession.Decision.ALLOWED : LocalSmsSession.Decision.DECLINED);
        resolveStatus(call);
    }
    @PluginMethod public void openInbox(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String token = call.getString("token");
            if (!BuildConfig.LOCAL_SMS_ENABLED || !session.allowed(token) || !hasPermission()) {
                call.reject("sms_access_denied"); return;
            }
            if (inboxOpen) { call.reject("sms_busy"); return; }
            inboxOpen = true;
            Intent intent = new Intent(getActivity(), LocalSmsActivity.class);
            intent.putExtra("sessionToken", token);
            startActivityForResult(call, intent, "inboxClosed");
        });
    }
    @ActivityCallback private void inboxClosed(PluginCall call, ActivityResult result) {
        inboxOpen = false;
        if (call != null) call.resolve(); // No SMS content in the result Intent.
    }
    private boolean hasPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
    }
    private void resolveStatus(PluginCall call) {
        String token = call.getString("token");
        if (!session.current(token)) { call.reject("sms_cancelled"); return; }
        JSObject result = new JSObject();
        result.put("decision", session.decision(token).name().toLowerCase(java.util.Locale.ROOT));
        result.put("permission", hasPermission());
        call.resolve(result);
    }
    private void cancelDisclosure() {
        if (disclosure != null) { disclosure.dismiss(); disclosure = null; }
        if (pendingConsent != null) { pendingConsent.reject("sms_cancelled"); pendingConsent = null; }
    }
    @Override protected void handleOnDestroy() {
        cancelDisclosure();
        // A WebView recreation must not leave a native inbox authorized.
        session.start(null);
        super.handleOnDestroy();
    }
}
