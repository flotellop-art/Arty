package com.arty.app;

import org.junit.Test;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

public class MailScopeWriteFenceTest {
    private String owner() { return UUID.randomUUID().toString(); }
    @Test public void oldWriteAndNewRetryCannotPassTerminalClear() throws Exception {
        String a = owner(), b = owner(); long old = MailScopeWriteFence.capture(a), other = MailScopeWriteFence.capture(b);
        long clear = MailScopeWriteFence.beginClear(a, true);
        AtomicInteger writes = new AtomicInteger();
        MailScopeWriteFence.clear(a, clear, () -> true);
        assertThrows(IllegalStateException.class, () -> MailScopeWriteFence.write(a, old, () -> { writes.incrementAndGet(); return true; }));
        assertThrows(IllegalStateException.class, () -> MailScopeWriteFence.capture(a));
        MailScopeWriteFence.write(b, other, () -> { writes.incrementAndGet(); return true; });
        assertEquals(1, writes.get());
        long legacy = MailScopeWriteFence.beginClear(a, false);
        MailScopeWriteFence.clear(a, legacy, () -> true);
        assertThrows(IllegalStateException.class, () -> MailScopeWriteFence.capture(a));
    }
    @Test public void eachClearOwnsItsTicketInEitherCompletionOrder() throws Exception {
        for (boolean oldFirst : new boolean[] {true, false}) {
            String a = owner(); long c1 = MailScopeWriteFence.beginClear(a, false), c2 = MailScopeWriteFence.beginClear(a, false);
            AtomicInteger commits = new AtomicInteger();
            if (!oldFirst) MailScopeWriteFence.clear(a, c2, () -> true);
            assertThrows(IllegalStateException.class, () -> MailScopeWriteFence.clear(a, c1, () -> { commits.incrementAndGet(); return true; }));
            if (oldFirst) {
                assertThrows(IllegalStateException.class, () -> MailScopeWriteFence.capture(a));
                MailScopeWriteFence.clear(a, c2, () -> true);
            }
            assertEquals(0, commits.get()); assertEquals(c2, MailScopeWriteFence.capture(a));
        }
    }
    @Test public void failedCommitStaysBlockedAndRetryNeverRevalidatesOldTicket() throws Exception {
        String a = owner(); long old = MailScopeWriteFence.capture(a), c1 = MailScopeWriteFence.beginClear(a, false);
        assertThrows(IllegalStateException.class, () -> MailScopeWriteFence.clear(a, c1, () -> false));
        assertThrows(IllegalStateException.class, () -> MailScopeWriteFence.capture(a));
        long c2 = MailScopeWriteFence.beginClear(a, false);
        MailScopeWriteFence.clear(a, c2, () -> true);
        assertThrows(IllegalStateException.class, () -> MailScopeWriteFence.write(a, old, () -> true));
        MailScopeWriteFence.write(a, MailScopeWriteFence.capture(a), () -> true);
    }
    @Test public void invalidUtf16IsRejectedBeforeAnyClearCommit() {
        for (String a : new String[] {"\uD800", "a\uDC00", "\uD800b"}) {
            assertFalse(MailScopeWriteFence.validScope(a));
            assertThrows(IllegalArgumentException.class, () -> MailScopeWriteFence.beginClear(a, true));
        }
        assertTrue(MailScopeWriteFence.validScope("a:b-é-\uD834\uDD1E"));
    }
    @Test public void clearCannotRaceInsideAnAlreadyValidatedPersistentCommit() throws Exception {
        String a = owner(); long ticket = MailScopeWriteFence.capture(a);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), clearing = new CountDownLatch(1);
        CompletableFuture<Void> writer = CompletableFuture.runAsync(() -> {
            try { MailScopeWriteFence.write(a, ticket, () -> { entered.countDown(); return release.await(5, TimeUnit.SECONDS); }); }
            catch (Exception e) { throw new RuntimeException(e); }
        });
        assertTrue(entered.await(5, TimeUnit.SECONDS));
        CompletableFuture<Long> clear = CompletableFuture.supplyAsync(() -> { clearing.countDown(); return MailScopeWriteFence.beginClear(a, true); });
        try { assertTrue(clearing.await(5, TimeUnit.SECONDS)); assertFalse(clear.isDone()); }
        finally { release.countDown(); }
        writer.get(5, TimeUnit.SECONDS); long current = clear.get(5, TimeUnit.SECONDS);
        MailScopeWriteFence.clear(a, current, () -> true);
        assertThrows(IllegalStateException.class, () -> MailScopeWriteFence.write(a, ticket, () -> true));
    }
}
