package com.arty.app;

import android.content.SharedPreferences;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Durable incarnation fence. All instances use the same monitor as the old
 * process ticket fence. SharedPreferences remove+receipt are ONE commit. The
 * receipt is not a credential and the shared Keystore alias is never deleted. */
final class MailScopeStorage {
    private final SharedPreferences prefs;
    MailScopeStorage(SharedPreferences prefs) { this.prefs = prefs; }
    static String accountKey(String scope) {
        if (!MailScopeWriteFence.validScope(scope)) throw new IllegalArgumentException("invalid_scope");
        return "accounts_" + Base64.encodeToString(scope.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP | Base64.URL_SAFE);
    }
    private static String receiptKey(String scope) { return "reset_" + accountKey(scope); }
    private static boolean id(String value) {
        return value != null && value.matches("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    }
    private static final class Receipt {
        final String id; final boolean open;
        Receipt(String id, boolean open) { this.id = id; this.open = open; }
    }
    private Receipt receipt(String scope) throws Exception {
        String key = receiptKey(scope);
        if (!prefs.contains(key)) return null;
        String raw = prefs.getString(key, null);
        if (raw == null || raw.length() > 160) throw new IllegalStateException("scope_unavailable");
        JSONObject o = new JSONObject(raw);
        if (o.length() != 3 || !(o.get("protocol") instanceof Integer) || o.getInt("protocol") != 2 ||
                !(o.get("resetId") instanceof String) || !id(o.getString("resetId")) || !(o.get("state") instanceof String) ||
                !("closed".equals(o.getString("state")) || "open".equals(o.getString("state")))) throw new IllegalStateException("scope_unavailable");
        // Exact canonical bytes also reject duplicate keys and coercive JSON.
        Receipt r = new Receipt(o.getString("resetId"), "open".equals(o.getString("state")));
        if (!encode(r).equals(raw)) throw new IllegalStateException("scope_unavailable");
        return r;
    }
    private static String encode(Receipt r) {
        return "{\"protocol\":2,\"resetId\":\"" + r.id + "\",\"state\":\"" + (r.open ? "open" : "closed") + "\"}";
    }
    private void incarnation(String scope, String expected) throws Exception {
        Receipt r = receipt(scope);
        if (r == null ? expected != null : !r.open || !r.id.equals(expected)) throw new IllegalStateException("scope_unavailable");
    }
    static final class Ticket {
        final String scope, incarnation; final long epoch;
        Ticket(String scope, String incarnation, long epoch) { this.scope = scope; this.incarnation = incarnation; this.epoch = epoch; }
    }
    Ticket capture(String scope, String expected) throws Exception {
        synchronized (MailScopeWriteFence.class) {
            incarnation(scope, expected);
            return new Ticket(scope, expected, MailScopeWriteFence.capture(scope));
        }
    }
    void assertCurrent(Ticket ticket) throws Exception {
        synchronized (MailScopeWriteFence.class) {
            incarnation(ticket.scope, ticket.incarnation);
            if (MailScopeWriteFence.capture(ticket.scope) != ticket.epoch) throw new IllegalStateException("scope_unavailable");
        }
    }
    void write(Ticket ticket, String ciphertext) throws Exception {
        synchronized (MailScopeWriteFence.class) {
            assertCurrent(ticket);
            MailScopeWriteFence.write(ticket.scope, ticket.epoch, () -> prefs.edit().putString(accountKey(ticket.scope), ciphertext).commit());
        }
    }
    String read(Ticket ticket) throws Exception {
        synchronized (MailScopeWriteFence.class) { assertCurrent(ticket); return prefs.getString(accountKey(ticket.scope), null); }
    }
    long beginLegacyClear(String scope, boolean terminal) throws Exception {
        synchronized (MailScopeWriteFence.class) {
            if (receipt(scope) != null) throw new IllegalStateException("scope_unavailable");
            return MailScopeWriteFence.beginClear(scope, terminal);
        }
    }
    void legacyClear(String scope, long ticket) throws Exception {
        synchronized (MailScopeWriteFence.class) {
            if (receipt(scope) != null) throw new IllegalStateException("scope_unavailable");
            MailScopeWriteFence.clear(scope, ticket, () -> prefs.edit().remove(accountKey(scope)).commit());
        }
    }
    void clearForReset(String scope, String resetId, String previousResetId) throws Exception {
        synchronized (MailScopeWriteFence.class) {
            if (!id(resetId) || (previousResetId != null && !id(previousResetId)) || resetId.equals(previousResetId)) throw new IllegalArgumentException("invalid_reset");
            Receipt r = receipt(scope);
            if (r != null && r.id.equals(resetId)) {
                // A replay after reopen MUST NOT erase newly written accounts.
                if (r.open || prefs.contains(accountKey(scope))) throw new IllegalStateException("reset_superseded");
            } else if (r == null ? previousResetId != null : !r.open || !r.id.equals(previousResetId)) throw new IllegalStateException("reset_superseded");
            long ticket = MailScopeWriteFence.beginClear(scope, true);
            MailScopeWriteFence.clear(scope, ticket, () -> prefs.edit().remove(accountKey(scope))
                    .putString(receiptKey(scope), encode(new Receipt(resetId, false))).commit());
        }
    }
    void reopen(String scope, String resetId) throws Exception {
        synchronized (MailScopeWriteFence.class) {
            if (!id(resetId)) throw new IllegalArgumentException("invalid_reset");
            Receipt r = receipt(scope);
            if (r == null || !r.id.equals(resetId)) throw new IllegalStateException("reset_superseded");
            // A provisioning retry can reopen only the physically empty scope.
            // Ordinary calls carrying the consumed incarnation need no reopen.
            if (prefs.contains(accountKey(scope))) throw new IllegalStateException("reset_not_empty");
            if (!prefs.edit().putString(receiptKey(scope), encode(new Receipt(resetId, true))).commit()) throw new IllegalStateException("reset_failed");
            MailScopeWriteFence.reopenAfterDurableReset(scope, resetId);
        }
    }
}
