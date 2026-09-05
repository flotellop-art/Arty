package com.arty.app;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import android.content.SharedPreferences;
import android.os.Process;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Run phaseOne, force-stop, phaseTwo, force-stop, phaseThree. Test preferences
 * contain ONLY synthetic data. Encryption/decryption invokes the actual plugin
 * implementation and AndroidKeyStore; no network IMAP claim follows. */
@RunWith(AndroidJUnit4.class)
public class MailScopeStorageInstrumentedTest {
    private static final String A = "reset-recipe-A", B = A + "-b", C = A + ":b";
    private static final String R1 = "a2111111-1111-4111-8111-111111111111", R2 = "a2222222-2222-4222-8222-222222222222";
    private SharedPreferences prefs() { return InstrumentationRegistry.getInstrumentation().getTargetContext().getSharedPreferences("arty_mail_reset_recipe_v2", 0); }
    private String crypto(String method, String value) throws Exception {
        Method m = MailImapPlugin.class.getDeclaredMethod(method, String.class); m.setAccessible(true);
        return (String) m.invoke(new MailImapPlugin(), value);
    }
    private String read(MailScopeStorage storage, String scope, String incarnation) throws Exception {
        return crypto("decrypt", storage.read(storage.capture(scope, incarnation)));
    }
    private void save(MailScopeStorage storage, String scope, String incarnation, String value) throws Exception {
        storage.write(storage.capture(scope, incarnation), crypto("encrypt", value));
    }
    private void checkpoint(int phase) {
        assertTrue(prefs().edit().putInt("phase", phase).putInt("pid", Process.myPid()).commit());
    }
    private void resumed(int phase) {
        assertEquals(phase, prefs().getInt("phase", -1)); assertNotEquals(Process.myPid(), prefs().getInt("pid", -1));
    }
    private void others(MailScopeStorage s) throws Exception { assertEquals("B private fixture", read(s, B, null)); assertEquals("C private fixture", read(s, C, null)); }
    private void requirePhase(String phase) {
        // These process-death phases cannot run in an unordered, single-process
        // connectedAndroidTest batch. Select each method explicitly (see ADR).
        assumeTrue("Select this restart recipe phase explicitly", InstrumentationRegistry.getArguments()
                .getString("class", "").equals(getClass().getName() + "#" + phase));
    }

    @Test public void phaseOne() throws Exception {
        requirePhase("phaseOne");
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        assertFalse("Run phaseOne on a fresh synthetic test installation", ks.containsAlias("arty-mail-imap-key"));
        assertTrue(prefs().edit().clear().commit()); // only the named synthetic test preferences
        // On a fresh AVD the alias does not yet exist. Real parallel plugin
        // instances must all obtain the same non-extractible Keystore key.
        ExecutorService pool = Executors.newFixedThreadPool(8);
        CountDownLatch ready = new CountDownLatch(8), release = new CountDownLatch(1);
        List<Future<String>> encrypted = new ArrayList<>();
        try {
            for (int i = 0; i < 8; i++) {
                final String value = "parallel first key " + i;
                encrypted.add(pool.submit(() -> { ready.countDown(); assertTrue(release.await(10, TimeUnit.SECONDS)); return crypto("encrypt", value); }));
            }
            assertTrue(ready.await(10, TimeUnit.SECONDS)); release.countDown();
            for (int i = 0; i < 8; i++) assertEquals("parallel first key " + i, crypto("decrypt", encrypted.get(i).get(20, TimeUnit.SECONDS)));
        } finally { release.countDown(); pool.shutdownNow(); }
        MailScopeStorage s = new MailScopeStorage(prefs());
        save(s, A, null, "old A fixture"); save(s, B, null, "B private fixture"); save(s, C, null, "C private fixture");
        String rawB = prefs().getString(MailScopeStorage.accountKey(B), null);
        MailScopeStorage.Ticket old = s.capture(A, null);
        s.clearForReset(A, R1, null);
        assertFalse(prefs().contains(MailScopeStorage.accountKey(A)));
        assertThrows(IllegalStateException.class, () -> s.write(old, "late"));
        assertThrows(IllegalStateException.class, () -> s.capture(A, null));
        assertThrows(IllegalStateException.class, () -> s.capture(A, R1));
        // Lost clear acknowledgement + new plugin instance, same process.
        new MailScopeStorage(prefs()).clearForReset(A, R1, null);
        s.reopen(A, R1); new MailScopeStorage(prefs()).reopen(A, R1);
        assertThrows(IllegalStateException.class, () -> s.write(old, "late"));
        assertThrows(IllegalStateException.class, () -> s.capture(A, null));
        save(s, A, R1, "fresh A one");
        assertThrows(IllegalStateException.class, () -> s.clearForReset(A, R1, null));
        assertThrows(IllegalStateException.class, () -> s.beginLegacyClear(A, true));
        assertThrows(IllegalStateException.class, () -> s.beginLegacyClear(A, false));
        assertEquals("fresh A one", read(s, A, R1)); assertEquals(rawB, prefs().getString(MailScopeStorage.accountKey(B), null)); others(s);
        checkpoint(1);
    }
    @Test public void phaseTwo() throws Exception {
        requirePhase("phaseTwo");
        resumed(1); MailScopeStorage s = new MailScopeStorage(prefs());
        assertThrows(IllegalStateException.class, () -> s.capture(A, null));
        assertEquals("fresh A one", read(s, A, R1)); others(s);
        MailScopeStorage.Ticket old = s.capture(A, R1);
        s.clearForReset(A, R2, R1);
        assertThrows(IllegalStateException.class, () -> s.write(old, "late one"));
        assertThrows(IllegalStateException.class, () -> s.reopen(A, R1));
        assertThrows(IllegalStateException.class, () -> s.clearForReset(A, R1, null));
        assertThrows(IllegalStateException.class, () -> s.capture(A, R2));
        assertFalse(prefs().contains(MailScopeStorage.accountKey(A))); others(s);
        checkpoint(2);
    }
    @Test public void phaseThree() throws Exception {
        requirePhase("phaseThree");
        resumed(2); MailScopeStorage s = new MailScopeStorage(prefs());
        assertThrows(IllegalStateException.class, () -> s.capture(A, null));
        assertThrows(IllegalStateException.class, () -> s.capture(A, R1));
        assertThrows(IllegalStateException.class, () -> s.capture(A, R2));
        s.clearForReset(A, R2, R1); s.reopen(A, R2);
        save(s, A, R2, "fresh A two");
        assertThrows(IllegalStateException.class, () -> s.clearForReset(A, R2, R1));
        assertThrows(IllegalStateException.class, () -> s.reopen(A, R1));
        assertThrows(IllegalStateException.class, () -> s.capture(A, R1));
        assertEquals("fresh A two", read(s, A, R2)); others(s);
        save(s, B, null, "B writable after two cycles"); assertEquals("B writable after two cycles", read(s, B, null));
        checkpoint(3);
    }
    private SharedPreferences failOneCommit(SharedPreferences real, boolean commitThenLoseAck) {
        AtomicInteger failures = new AtomicInteger(1);
        return (SharedPreferences) Proxy.newProxyInstance(SharedPreferences.class.getClassLoader(), new Class<?>[]{SharedPreferences.class}, (proxy, method, args) -> {
            if (!method.getName().equals("edit")) return method.invoke(real, args);
            SharedPreferences.Editor editor = real.edit();
            return Proxy.newProxyInstance(SharedPreferences.Editor.class.getClassLoader(), new Class<?>[]{SharedPreferences.Editor.class}, (p, m, a) -> {
                if (m.getName().equals("commit") && failures.getAndDecrement() > 0) {
                    if (commitThenLoseAck) assertTrue(editor.commit());
                    return false;
                }
                Object result = m.invoke(editor, a);
                return result instanceof SharedPreferences.Editor ? p : result;
            });
        });
    }
    @Test public void failedCommitsAndMalformedReceiptRemainClosed() throws Exception {
        for (boolean after : new boolean[]{false, true}) {
            String owner = "fault-" + UUID.randomUUID(), reset = UUID.randomUUID().toString();
            MailScopeStorage normal = new MailScopeStorage(prefs()); save(normal, owner, null, "own synthetic data");
            MailScopeStorage failing = new MailScopeStorage(failOneCommit(prefs(), after));
            assertThrows(IllegalStateException.class, () -> failing.clearForReset(owner, reset, null));
            assertThrows(IllegalStateException.class, () -> normal.capture(owner, null));
            normal.clearForReset(owner, reset, null);
            MailScopeStorage failedOpen = new MailScopeStorage(failOneCommit(prefs(), after));
            assertThrows(IllegalStateException.class, () -> failedOpen.reopen(owner, reset));
            assertThrows(IllegalStateException.class, () -> normal.capture(owner, reset));
            normal.reopen(owner, reset); save(normal, owner, reset, "new synthetic data");
            assertEquals("new synthetic data", read(normal, owner, reset));
        }
        for (String bad : new String[]{"null", "{}", "{\"protocol\":2,\"resetId\":\"" + R1 + "\",\"state\":\"open\",\"extra\":true}",
                "{\"protocol\":2,\"protocol\":2,\"resetId\":\"" + R1 + "\",\"state\":\"open\"}"}) {
            String owner = "malformed-" + UUID.randomUUID(); MailScopeStorage s = new MailScopeStorage(prefs()); save(s, owner, null, "retained");
            String raw = prefs().getString(MailScopeStorage.accountKey(owner), null);
            assertTrue(prefs().edit().putString("reset_" + MailScopeStorage.accountKey(owner), bad).commit());
            assertThrows(Exception.class, () -> s.capture(owner, null));
            assertThrows(Exception.class, () -> s.capture(owner, R1));
            assertThrows(Exception.class, () -> s.clearForReset(owner, R2, R1));
            assertEquals(raw, prefs().getString(MailScopeStorage.accountKey(owner), null));
        }
    }
}
