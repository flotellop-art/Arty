package com.arty.app;

import java.util.HashMap;
import java.util.Map;

/** Process-wide, shared by all plugin instances. A ticket is captured before
 * queuing/network. Its check and the persistent commit form one critical section.
 * This excludes late writes, not concurrent stale-read lost updates. */
final class MailScopeWriteFence {
    private static final Map<String, State> states = new HashMap<>();
    private static final class State { long epoch; boolean blocked; boolean terminal; String incarnation; }
    interface Commit { boolean run() throws Exception; }
    static boolean validScope(String scope) {
        if (scope == null || scope.isEmpty() || scope.length() > 128) return false;
        for (int i = 0; i < scope.length(); i++) {
            char c = scope.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (++i >= scope.length() || !Character.isLowSurrogate(scope.charAt(i))) return false;
            } else if (Character.isLowSurrogate(c)) return false;
        }
        return true;
    }
    private static State state(String scope) {
        if (!validScope(scope)) throw new IllegalArgumentException("invalid_scope");
        State s = states.get(scope);
        if (s == null) { s = new State(); states.put(scope, s); }
        return s;
    }
    static synchronized long capture(String scope) {
        State s = state(scope);
        if (s.blocked) throw new IllegalStateException("scope_erasing");
        return s.epoch;
    }
    static synchronized void write(String scope, long ticket, Commit commit) throws Exception {
        State s = state(scope);
        if (s.blocked || s.epoch != ticket) throw new IllegalStateException("scope_erasing");
        if (!commit.run()) throw new IllegalStateException("save_failed");
    }
    static synchronized long beginClear(String scope, boolean terminal) {
        State s = state(scope);
        if (s.epoch == Long.MAX_VALUE) throw new IllegalStateException("scope_exhausted");
        s.epoch++; s.blocked = true; s.terminal |= terminal;
        return s.epoch;
    }
    static synchronized void clear(String scope, long ticket, Commit commit) throws Exception {
        State s = state(scope);
        if (!s.blocked || s.epoch != ticket) throw new IllegalStateException("clear_superseded");
        if (!commit.run()) throw new IllegalStateException("clear_failed");
        // The cold path NEVER reopens A. Even a later legacy clear cannot do so.
        s.blocked = s.terminal;
    }
    /** Package-internal, called ONLY after the durable exact reset CAS. A retry
     * cannot invalidate new tickets once that same incarnation is already open. */
    static synchronized void reopenAfterDurableReset(String scope, String incarnation) {
        State s = state(scope);
        if (!s.blocked && incarnation.equals(s.incarnation)) return;
        if (s.epoch == Long.MAX_VALUE) throw new IllegalStateException("scope_exhausted");
        s.epoch++; s.blocked = false; s.terminal = false; s.incarnation = incarnation;
    }
}
