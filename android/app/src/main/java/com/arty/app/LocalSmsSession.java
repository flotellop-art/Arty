package com.arty.app;

/** Process-memory consent only: nothing to back up, sync or resurrect after logout.
 * The opaque ticket changes for every Arty owner/session, even A -> logout -> A.
 */
final class LocalSmsSession {
    static final LocalSmsSession INSTANCE = new LocalSmsSession();
    enum Decision { UNKNOWN, DECLINED, ALLOWED }
    private String token;
    private Decision decision = Decision.UNKNOWN;
    private Runnable observer;

    synchronized void start(String next) {
        token = next;
        decision = Decision.UNKNOWN;
        changed();
    }
    synchronized boolean current(String candidate) {
        return token != null && token.equals(candidate);
    }
    synchronized boolean allowed(String candidate) {
        return current(candidate) && decision == Decision.ALLOWED;
    }
    synchronized Decision decision(String candidate) {
        return current(candidate) ? decision : Decision.DECLINED;
    }
    synchronized boolean decide(String candidate, Decision next) {
        if (!current(candidate)) return false;
        decision = next;
        changed();
        return true;
    }
    synchronized void end(String candidate) {
        if (!current(candidate)) return;
        token = null;
        decision = Decision.UNKNOWN;
        changed();
    }
    synchronized void observe(Runnable next) { observer = next; }
    synchronized void removeObserver(Runnable old) { if (observer == old) observer = null; }
    private void changed() { if (observer != null) observer.run(); }
}
