package com.arty.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

// Captures Android Share intents (ACTION_SEND) and exposes the payload to JS.
// Reads URI bytes IMMEDIATELY at intent reception because the
// FLAG_GRANT_READ_URI_PERMISSION granted by the sharing app is only valid
// for the lifetime of the intent — by the time JS calls getPendingShare()
// the URI may be unreadable.
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    private static final long MAX_FILE_SIZE_BYTES = 10L * 1024 * 1024; // 10 MB

    private final Object lock = new Object();
    private JSObject pendingPayload = null;

    @Override
    public void load() {
        // Cold start — the launching intent is already on the activity.
        Intent intent = getActivity().getIntent();
        if (intent != null) {
            consumeIntent(intent, false);
        }
    }

    // Called from MainActivity.onNewIntent when the app is already in memory
    // (singleTask launchMode). Notifies JS via the `shareReceived` event.
    public void handleNewIntent(Intent intent) {
        if (intent == null) return;
        consumeIntent(intent, true);
    }

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        synchronized (lock) {
            JSObject payload = pendingPayload;
            pendingPayload = null;
            if (payload == null) {
                JSObject empty = new JSObject();
                empty.put("text", JSObject.NULL);
                empty.put("file", JSObject.NULL);
                empty.put("error", JSObject.NULL);
                call.resolve(empty);
            } else {
                call.resolve(payload);
            }
        }
    }

    private void consumeIntent(Intent intent, boolean emitEvent) {
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action)) return;

        JSObject payload = parseIntent(intent);
        if (payload == null) return;

        synchronized (lock) {
            pendingPayload = payload;
        }
        if (emitEvent) {
            notifyListeners("shareReceived", payload);
        }
    }

    private JSObject parseIntent(Intent intent) {
        JSObject payload = new JSObject();
        payload.put("text", JSObject.NULL);
        payload.put("file", JSObject.NULL);
        payload.put("error", JSObject.NULL);

        boolean hasContent = false;

        // Text branch (EXTRA_TEXT can also accompany an image — keep both).
        CharSequence sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (sharedText != null) {
            String text = sharedText.toString();
            if (!text.isEmpty()) {
                payload.put("text", text);
                hasContent = true;
            }
        }

        // File branch — EXTRA_STREAM can be null even when mimeType says image/*.
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri != null) {
            JSObject file = readFile(uri, intent.getType());
            if (file != null) {
                if (file.has("error")) {
                    payload.put("error", file.getString("error"));
                } else {
                    payload.put("file", file);
                    hasContent = true;
                }
            }
        }

        return hasContent || payload.getString("error", null) != null ? payload : null;
    }

    private JSObject readFile(Uri uri, String fallbackMime) {
        ContentResolver resolver = getContext().getContentResolver();

        // Resolver mime is more reliable than the intent type (shared PDFs
        // sometimes arrive as application/octet-stream at the intent layer).
        String mimeType = resolver.getType(uri);
        if (mimeType == null) mimeType = fallbackMime;
        if (mimeType == null) mimeType = "application/octet-stream";

        String name = "shared";
        long size = -1;
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                    name = cursor.getString(nameIdx);
                }
                if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                    size = cursor.getLong(sizeIdx);
                }
            }
        } catch (Exception ignored) {
            // Some providers don't support OpenableColumns — fall back to
            // streaming and we'll discover the size during read.
        }

        if (size > MAX_FILE_SIZE_BYTES) {
            JSObject err = new JSObject();
            err.put("error", "file_too_large");
            return err;
        }

        byte[] bytes;
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            bytes = readAllCapped(in, MAX_FILE_SIZE_BYTES + 1);
        } catch (Exception e) {
            return null;
        }
        if (bytes == null) {
            JSObject err = new JSObject();
            err.put("error", "file_too_large");
            return err;
        }

        String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
        JSObject file = new JSObject();
        file.put("name", name);
        file.put("mimeType", mimeType);
        file.put("base64", base64);
        file.put("sizeBytes", bytes.length);
        return file;
    }

    // Reads up to `cap` bytes; returns null if the stream exceeds the cap.
    private byte[] readAllCapped(InputStream in, long cap) throws java.io.IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8 * 1024];
        long total = 0;
        int n;
        while ((n = in.read(chunk)) != -1) {
            total += n;
            if (total > cap) return null;
            buffer.write(chunk, 0, n);
        }
        return buffer.toByteArray();
    }
}
