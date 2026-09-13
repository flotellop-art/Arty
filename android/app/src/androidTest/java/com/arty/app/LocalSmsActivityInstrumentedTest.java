package com.arty.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.view.WindowManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static org.hamcrest.Matchers.containsString;

/** ONLY a dedicated AVD seeded with synthetic SMS; never read a physical phone.
 * adb emu sms send 15550000001 SMS-LOCAL-FIXTURE-ALPHA
 * adb emu sms send 15550000002 SMS-LOCAL-FIXTURE-BETA
 */
@RunWith(AndroidJUnit4.class)
public class LocalSmsActivityInstrumentedTest {
    private final String token = "synthetic-sms-session-1234567890";
    @Before public void syntheticEmulatorOnly() {
        assumeTrue(BuildConfig.LOCAL_SMS_ENABLED);
        assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("smsSyntheticFixture")));
        assumeTrue(Build.HARDWARE.equals("ranchu") || Build.HARDWARE.equals("goldfish"));
        InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(
            InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName(), Manifest.permission.READ_SMS);
    }
    private Activity open(boolean consent) {
        LocalSmsSession.INSTANCE.start(token);
        if (consent) LocalSmsSession.INSTANCE.decide(token, LocalSmsSession.Decision.ALLOWED);
        Intent intent = new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(), LocalSmsActivity.class);
        intent.putExtra("sessionToken", token); intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return InstrumentationRegistry.getInstrumentation().startActivitySync(intent);
    }
    private void awaitText(String fragment) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 7000;
        Throwable last = null;
        do {
            try { onView(withText(containsString(fragment))).check(matches(isDisplayed())); return; }
            catch (AssertionError | RuntimeException missing) { last = missing; Thread.sleep(100); }
        } while (android.os.SystemClock.elapsedRealtime() < deadline);
        throw new AssertionError("Synthetic SMS view did not reach expected state", last);
    }
    @Test public void localReadSearchAndWithdrawal() throws Exception {
        Activity activity = open(true);
        try {
            assertTrue((activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0);
            awaitText("SMS-LOCAL-FIXTURE-ALPHA");
            onView(withHint(R.string.sms_search_hint)).perform(replaceText("BETA"), closeSoftKeyboard());
            onView(withText(R.string.sms_search)).perform(click());
            awaitText("SMS-LOCAL-FIXTURE-BETA");
            onView(withText(R.string.sms_revoke)).perform(click());
            assertFalse(LocalSmsSession.INSTANCE.allowed(token));
        } finally { InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish); }
    }
    @Test public void sessionChangeClosesNativeViewer() throws Exception {
        Activity activity = open(true);
        try {
            awaitText("SMS-LOCAL-FIXTURE-ALPHA");
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> LocalSmsSession.INSTANCE.start("another-session"));
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            assertTrue(activity.isFinishing() || activity.isDestroyed());
            assertFalse(LocalSmsSession.INSTANCE.allowed("another-session"));
        } finally { InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish); }
    }
}
