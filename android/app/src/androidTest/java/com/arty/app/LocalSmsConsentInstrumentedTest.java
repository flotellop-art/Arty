package com.arty.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.*;

/** Real Capacitor bridge + native disclosure, only in the isolated synthetic AVD. */
@RunWith(AndroidJUnit4.class)
public class LocalSmsConsentInstrumentedTest {
    @Test public void decliningNativeDisclosureLeavesArtyUsableWithoutSms() throws Exception { exercise(false); }
    @Test public void acceptsAndroidPermissionAfterDisclosure() throws Exception {
        // Explicit recipe: revoke READ_SMS before this method to exercise the OS dialog.
        assumeTrue(InstrumentationRegistry.getArguments().getString("class", "").endsWith("#acceptsAndroidPermissionAfterDisclosure"));
        exercise(true);
    }
    private void exercise(boolean accept) throws Exception {
        assumeTrue(BuildConfig.LOCAL_SMS_ENABLED);
        assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("smsSyntheticFixture")));
        assumeTrue(Build.HARDWARE.equals("ranchu") || Build.HARDWARE.equals("goldfish"));
        if (accept) assertEquals(android.content.pm.PackageManager.PERMISSION_DENIED,
            InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(android.Manifest.permission.READ_SMS));
        Intent intent = new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(intent);
        try {
            String script = "window.Capacitor.nativePromise('LocalSms','startSession',{token:'synthetic-consent-session-12345'}).then(function(){return window.Capacitor.nativePromise('LocalSms','requestAccess',{token:'synthetic-consent-session-12345'})})";
            // Wait for the real bridge script, without modifying the web app or auth state.
            long deadline = android.os.SystemClock.elapsedRealtime() + 10000;
            boolean ready = false;
            while (!ready && android.os.SystemClock.elapsedRealtime() < deadline) {
                java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
                java.util.concurrent.atomic.AtomicBoolean bridgeReady = new java.util.concurrent.atomic.AtomicBoolean();
                InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(
                    "Boolean(window.Capacitor && window.Capacitor.nativePromise)", result -> { bridgeReady.set("true".equals(result)); latch.countDown(); }));
                assertTrue(latch.await(2, java.util.concurrent.TimeUnit.SECONDS));
                ready = bridgeReady.get(); if (!ready) Thread.sleep(100);
            }
            assertTrue("Capacitor bridge ready", ready);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(script, null));
            long dialogDeadline = android.os.SystemClock.elapsedRealtime() + 5000;
            while (true) {
                try { onView(withText(R.string.sms_consent_title)).check(matches(isDisplayed())); break; }
                catch (AssertionError | RuntimeException missing) {
                    if (android.os.SystemClock.elapsedRealtime() >= dialogDeadline) throw missing;
                    Thread.sleep(100);
                }
            }
            onView(withText(accept ? R.string.sms_allow : R.string.sms_decline)).perform(click());
            if (accept) {
                boolean clicked = false;
                long permissionDeadline = android.os.SystemClock.elapsedRealtime() + 10000;
                while (!clicked && android.os.SystemClock.elapsedRealtime() < permissionDeadline) {
                    android.view.accessibility.AccessibilityNodeInfo root = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
                    if (root != null) {
                        for (android.view.accessibility.AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByViewId("com.android.permissioncontroller:id/permission_allow_button")) {
                            clicked |= node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
                        }
                    }
                    if (!clicked) Thread.sleep(100);
                }
                assertTrue("Real Android permission dialog was accepted", clicked);
                long resultDeadline = android.os.SystemClock.elapsedRealtime() + 5000;
                while (!LocalSmsSession.INSTANCE.allowed("synthetic-consent-session-12345") && android.os.SystemClock.elapsedRealtime() < resultDeadline) Thread.sleep(100);
                assertTrue(LocalSmsSession.INSTANCE.allowed("synthetic-consent-session-12345"));
            } else {
                assertEquals(LocalSmsSession.Decision.DECLINED, LocalSmsSession.INSTANCE.decision("synthetic-consent-session-12345"));
                assertFalse(LocalSmsSession.INSTANCE.allowed("synthetic-consent-session-12345"));
            }
            assertFalse(activity.isFinishing());
        } finally { InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish); }
    }
}
