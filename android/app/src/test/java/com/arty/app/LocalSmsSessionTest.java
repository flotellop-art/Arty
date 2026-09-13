package com.arty.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.atomic.AtomicInteger;

public class LocalSmsSessionTest {
    @Test public void noConsentOnStartOrRestart() {
        LocalSmsSession s = new LocalSmsSession();
        assertFalse(s.allowed(null)); s.start("A1"); assertFalse(s.allowed("A1"));
        s.decide("A1", LocalSmsSession.Decision.ALLOWED); assertTrue(s.allowed("A1"));
        assertFalse(new LocalSmsSession().allowed("A1"));
    }
    @Test public void latePermissionCallbackCannotAuthorizeAnotherSessionOrReconnectedOwner() {
        LocalSmsSession s = new LocalSmsSession();
        s.start("A1"); s.end("A1"); s.start("B1");
        assertFalse(s.decide("A1", LocalSmsSession.Decision.ALLOWED)); assertFalse(s.allowed("B1"));
        s.start("A2"); assertFalse(s.decide("A1", LocalSmsSession.Decision.ALLOWED)); assertFalse(s.allowed("A2"));
    }
    @Test public void oldLogoutDoesNotCancelNewSession() {
        LocalSmsSession s = new LocalSmsSession(); s.start("A1"); s.start("B1");
        s.decide("B1", LocalSmsSession.Decision.ALLOWED); s.end("A1"); assertTrue(s.allowed("B1"));
    }
    @Test public void withdrawalImmediatelyInvalidatesReaderAndNotifiesViewer() {
        LocalSmsSession s = new LocalSmsSession(); s.start("A1"); s.decide("A1", LocalSmsSession.Decision.ALLOWED);
        AtomicInteger changes = new AtomicInteger(); s.observe(changes::incrementAndGet);
        s.decide("A1", LocalSmsSession.Decision.DECLINED);
        assertFalse(s.allowed("A1")); assertEquals(1, changes.get());
    }
    @Test public void staleUiObserverCannotDetachNewViewer() {
        LocalSmsSession s = new LocalSmsSession(); AtomicInteger changes = new AtomicInteger();
        Runnable old = () -> {}, next = changes::incrementAndGet;
        s.observe(old); s.observe(next); s.removeObserver(old); s.start("A1"); assertEquals(1, changes.get());
    }
    @Test public void searchTreatsSqlWildcardsLiterallyAndCapsInput() {
        assertEquals("%50\\%\\_\\\\%", LocalSmsQuery.search(" 50%_\\ "));
        assertEquals("%%", LocalSmsQuery.search(null));
        assertThrows(IllegalArgumentException.class, () -> LocalSmsQuery.search(new String(new char[101]).replace('\0', 'x')));
    }
    @Test public void providerTextIsBounded() {
        assertEquals("abc…", LocalSmsQuery.bounded("abcdef", 3));
        assertEquals("", LocalSmsQuery.bounded(null, 3));
    }
}
