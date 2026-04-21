package com.arty.app;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Mutes Android system + media streams while webkitSpeechRecognition is
// running so the OS-level SpeechRecognizer startup beep does not play.
// Notification, ring and voice-call streams are NEVER touched — incoming
// notifications must remain audible during dictation. See BUG 46.
@CapacitorPlugin(name = "AudioBeepMute")
public class AudioBeepMutePlugin extends Plugin {

    private AudioManager audioManager;
    private int muteRefCount = 0;
    private final Object lock = new Object();

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void muteForBeep(PluginCall call) {
        synchronized (lock) {
            if (muteRefCount == 0) {
                applyMute();
            }
            muteRefCount++;
            JSObject ret = new JSObject();
            ret.put("muted", true);
            ret.put("refCount", muteRefCount);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void restoreFromBeep(PluginCall call) {
        synchronized (lock) {
            if (muteRefCount > 0) {
                muteRefCount--;
            }
            if (muteRefCount == 0) {
                applyUnmute();
            }
            JSObject ret = new JSObject();
            ret.put("muted", muteRefCount > 0);
            ret.put("refCount", muteRefCount);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void forceRestore(PluginCall call) {
        forceRestoreInternal();
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        forceRestoreInternal();
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        forceRestoreInternal();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        forceRestoreInternal();
    }

    private void forceRestoreInternal() {
        synchronized (lock) {
            muteRefCount = 0;
            applyUnmute();
        }
    }

    private void applyMute() {
        if (audioManager == null) return;
        try {
            audioManager.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_MUTE, 0);
            audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0);
        } catch (SecurityException ignored) {
            // DND policy can block the call on certain OEMs — skip silently.
        }
    }

    private void applyUnmute() {
        if (audioManager == null) return;
        try {
            audioManager.adjustStreamVolume(AudioManager.STREAM_SYSTEM, AudioManager.ADJUST_UNMUTE, 0);
            audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
        } catch (SecurityException ignored) {
            // Same as above.
        }
    }
}
