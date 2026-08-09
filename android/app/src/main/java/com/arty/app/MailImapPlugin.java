package com.arty.app;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.mail.Address;
import javax.mail.AuthenticationFailedException;
import javax.mail.FetchProfile;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.UIDFolder;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeUtility;
import javax.mail.search.BodyTerm;
import javax.mail.search.FromStringTerm;
import javax.mail.search.OrTerm;
import javax.mail.search.SearchTerm;
import javax.mail.search.SubjectTerm;

import org.json.JSONArray;
import org.json.JSONObject;

// Client IMAP LECTURE SEULE embarqué sur l'appareil (décision du 9 août 2026,
// architecture « natif d'abord » : le mot de passe d'application ne quitte
// jamais le téléphone, la connexion part de l'IP résidentielle de
// l'utilisateur — pas de relais serveur, pas de credential côté Cloudflare).
//
// Sécurité :
// - Mots de passe chiffrés AES-256-GCM avec une clé Android Keystore
//   non-extractible ; le ciphertext vit dans SharedPreferences, scopé par
//   utilisateur Arty (paramètre `scope`).
// - Port TLS 993 UNIQUEMENT (SSL direct, jamais STARTTLS), vérification
//   d'identité serveur activée.
// - Lecture seule stricte : Folder.READ_ONLY — aucun flag \Seen posé,
//   aucune écriture possible dans la boîte.
// - Aucune donnée sensible (mot de passe, contenu de message) ne part dans
//   les logs ni dans les messages d'erreur.
@CapacitorPlugin(name = "MailImap")
public class MailImapPlugin extends Plugin {

    private static final String PREFS_NAME = "arty_mail_accounts";
    private static final String KEYSTORE_ALIAS = "arty-mail-imap-key";
    private static final int GCM_TAG_BITS = 128;
    private static final int MAX_ACCOUNTS_PER_SCOPE = 5;
    private static final int MAX_LIST = 20;
    private static final int MAX_BODY_CHARS = 8000;
    private static final int SEARCH_FALLBACK_SCAN = 50;
    private static final int CONNECT_TIMEOUT_MS = 12000;
    private static final int READ_TIMEOUT_MS = 15000;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    // ── Validation des entrées ────────────────────────────────────────────

    static boolean hasControlChars(String s) {
        if (s == null) return false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < 0x20 || c == 0x7f) return true;
        }
        return false;
    }

    // NB : hasControlChars ne filtre volontairement PAS les blancs Unicode
    // (U+00A0 ≥ 0x20) — les rejeter casserait des mots de passe IMAP
    // génériques légitimes. La normalisation des mots de passe d'application
    // (espaces du format Google 4×4) est une règle produit qui vit côté TS
    // (src/services/mailPassword.ts), pas ici.

    static String validateAccountInput(String host, String email, String password) {
        if (host == null || host.isEmpty() || host.length() > 253 || hasControlChars(host)
                || !host.matches("^[a-zA-Z0-9.-]+$")) {
            return "invalid_host";
        }
        if (email == null || email.isEmpty() || email.length() > 254 || hasControlChars(email)) {
            return "invalid_email";
        }
        if (password == null || password.isEmpty() || password.length() > 256 || hasControlChars(password)) {
            return "invalid_password";
        }
        return null;
    }

    /**
     * Réponse du serveur IMAP sur un refus d'authentification : une ligne,
     * bornée, sans caractères de contrôle. Elle ne contient jamais le mot de
     * passe (JavaMail y met la ligne de réponse du serveur) et ne quitte pas
     * l'appareil. La remonter est vital pour le diagnostic (leçon BUG 64 :
     * masquer la CATÉGORIE d'une erreur tue le diagnostic) — Gmail y distingue
     * « Invalid credentials », « Application-specific password required »,
     * « [ALERT] Please log in via your web browser », etc.
     */
    static String sanitizeServerMessage(String raw) {
        if (raw == null) return "";
        String s = raw.replaceAll("[\\r\\n\\t]+", " ").replaceAll("[\\x00-\\x1f\\x7f]", "").trim();
        return s.length() <= 200 ? s : s.substring(0, 200);
    }

    /** Code de rejet auth : "auth_failed" seul, ou suffixé du détail serveur. */
    static String authFailedCode(Exception e) {
        String detail = sanitizeServerMessage(e.getMessage());
        return detail.isEmpty() ? "auth_failed" : "auth_failed: " + detail;
    }

    // ── Chiffrement Keystore ──────────────────────────────────────────────

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEYSTORE_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return gen.generateKey();
    }

    private String encrypt(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private String decrypt(String stored) throws Exception {
        int sep = stored.indexOf(':');
        if (sep < 0) throw new IllegalArgumentException("bad_ciphertext");
        byte[] iv = Base64.decode(stored.substring(0, sep), Base64.NO_WRAP);
        byte[] ct = Base64.decode(stored.substring(sep + 1), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
    }

    // ── Stockage des comptes (par scope utilisateur Arty) ─────────────────

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, 0);
    }

    private static String scopeKey(String scope) {
        // Le scope vient de l'app (userId Arty) — on le neutralise pour la clé prefs.
        return "accounts_" + Base64.encodeToString(
                scope.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP | Base64.URL_SAFE);
    }

    private JSONArray loadAccounts(String scope) throws Exception {
        String stored = prefs().getString(scopeKey(scope), null);
        if (stored == null) return new JSONArray();
        try {
            return new JSONArray(decrypt(stored));
        } catch (Exception e) {
            // Blob indéchiffrable (clé Keystore régénérée après réinstallation…) :
            // repartir de zéro plutôt que bloquer la feature (leçon BUG 61 —
            // ici pas de quarantaine : sans la clé Keystore le blob est
            // définitivement illisible, le garder n'aide personne).
            return new JSONArray();
        }
    }

    private void saveAccounts(String scope, JSONArray accounts) throws Exception {
        prefs().edit().putString(scopeKey(scope), encrypt(accounts.toString())).apply();
    }

    private JSONObject findAccount(JSONArray accounts, String id) throws Exception {
        for (int i = 0; i < accounts.length(); i++) {
            JSONObject a = accounts.getJSONObject(i);
            if (id.equals(a.optString("id"))) return a;
        }
        return null;
    }

    // ── Connexion IMAP ────────────────────────────────────────────────────

    private Store connectStore(String host, String email, String password) throws MessagingException {
        Properties props = new Properties();
        props.put("mail.store.protocol", "imaps");
        props.put("mail.imaps.host", host);
        props.put("mail.imaps.port", "993");
        props.put("mail.imaps.ssl.enable", "true");
        props.put("mail.imaps.ssl.checkserveridentity", "true");
        props.put("mail.imaps.connectiontimeout", String.valueOf(CONNECT_TIMEOUT_MS));
        props.put("mail.imaps.timeout", String.valueOf(READ_TIMEOUT_MS));
        props.put("mail.imaps.writetimeout", String.valueOf(CONNECT_TIMEOUT_MS));
        // Jamais de repli en clair, jamais de STARTTLS.
        props.put("mail.imaps.starttls.enable", "false");
        Session session = Session.getInstance(props);
        Store store = session.getStore("imaps");
        store.connect(host, 993, email, password);
        return store;
    }

    private interface StoreTask {
        void run(Store store, JSONObject account) throws Exception;
    }

    /** Ouvre le store du compte `id`, exécute la tâche, ferme toujours le store. */
    private void withStore(PluginCall call, StoreTask task) {
        String scope = call.getString("scope");
        String id = call.getString("id");
        if (scope == null || id == null) {
            call.reject("invalid_input");
            return;
        }
        executor.execute(() -> {
            Store store = null;
            try {
                JSONObject account = findAccount(loadAccounts(scope), id);
                if (account == null) {
                    call.reject("account_not_found");
                    return;
                }
                store = connectStore(
                        account.getString("host"),
                        account.getString("email"),
                        account.getString("password"));
                task.run(store, account);
            } catch (AuthenticationFailedException e) {
                call.reject(authFailedCode(e));
            } catch (MessagingException e) {
                call.reject("connect_failed");
            } catch (Exception e) {
                call.reject("mail_error");
            } finally {
                closeQuietly(store);
            }
        });
    }

    private static void closeQuietly(Store store) {
        if (store != null) {
            try { store.close(); } catch (Exception ignored) { }
        }
    }

    private static void closeQuietly(Folder folder) {
        if (folder != null && folder.isOpen()) {
            // false = n'expunge jamais (lecture seule).
            try { folder.close(false); } catch (Exception ignored) { }
        }
    }

    // ── Extraction de contenu ─────────────────────────────────────────────

    /** Supprime blocs style/script/head PUIS les tags (leçon BUG 49). */
    static String htmlToText(String html) {
        if (html == null) return "";
        String s = html
                .replaceAll("(?is)<(script|style|head)[^>]*>.*?</\\1>", " ")
                .replaceAll("(?is)<br\\s*/?>", "\n")
                .replaceAll("(?is)</p>", "\n")
                .replaceAll("(?is)<[^>]+>", " ")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'");
        return s.replaceAll("[ \\t\\x0B\\f\\r]+", " ").replaceAll("\\n{3,}", "\n\n").trim();
    }

    /** Extrait le texte d'un message : text/plain prioritaire, sinon HTML converti. */
    static String extractText(Part part) throws Exception {
        if (part.isMimeType("text/plain")) {
            Object c = part.getContent();
            return c instanceof String ? (String) c : "";
        }
        if (part.isMimeType("text/html")) {
            Object c = part.getContent();
            return c instanceof String ? htmlToText((String) c) : "";
        }
        if (part.isMimeType("multipart/*")) {
            Object content = part.getContent();
            if (content instanceof Multipart) {
                Multipart mp = (Multipart) content;
                String htmlFallback = "";
                for (int i = 0; i < mp.getCount(); i++) {
                    Part p = mp.getBodyPart(i);
                    // Jamais les pièces jointes : contenu inline uniquement.
                    String disposition = p.getDisposition();
                    if (disposition != null && disposition.equalsIgnoreCase(Part.ATTACHMENT)) continue;
                    if (p.isMimeType("text/plain")) {
                        String t = extractText(p);
                        if (!t.isEmpty()) return t;
                    } else if (p.isMimeType("text/html") && htmlFallback.isEmpty()) {
                        htmlFallback = extractText(p);
                    } else if (p.isMimeType("multipart/*")) {
                        String t = extractText(p);
                        if (!t.isEmpty()) return t;
                    }
                }
                return htmlFallback;
            }
        }
        return "";
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "\n[… message tronqué]";
    }

    private static String decodeHeader(String raw) {
        if (raw == null) return "";
        try {
            return MimeUtility.decodeText(raw);
        } catch (Exception e) {
            return raw;
        }
    }

    private static String formatAddresses(Address[] addresses) {
        if (addresses == null || addresses.length == 0) return "";
        StringBuilder sb = new StringBuilder();
        for (Address a : addresses) {
            if (sb.length() > 0) sb.append(", ");
            if (a instanceof InternetAddress) {
                InternetAddress ia = (InternetAddress) a;
                String personal = ia.getPersonal();
                sb.append(personal != null && !personal.isEmpty()
                        ? personal + " <" + ia.getAddress() + ">"
                        : String.valueOf(ia.getAddress()));
            } else {
                sb.append(decodeHeader(a.toString()));
            }
        }
        return sb.toString();
    }

    /** ISO 8601 UTC sans java.time : Date#toInstant exige l'API 26, minSdk = 24. */
    private static String formatUtc(Date d) {
        if (d == null) return "";
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(d);
    }

    private JSObject messageSummary(Folder folder, Message msg) throws Exception {
        JSObject o = new JSObject();
        long uid = folder instanceof UIDFolder ? ((UIDFolder) folder).getUID(msg) : -1;
        o.put("uid", uid);
        o.put("subject", decodeHeader(msg.getSubject() == null ? "(sans objet)" : msg.getSubject()));
        o.put("from", formatAddresses(msg.getFrom()));
        Date d = msg.getReceivedDate() != null ? msg.getReceivedDate() : msg.getSentDate();
        o.put("date", formatUtc(d));
        return o;
    }

    private static int clampLimit(PluginCall call) {
        Integer raw = call.getInt("limit");
        int limit = raw == null ? 10 : raw;
        return Math.max(1, Math.min(limit, MAX_LIST));
    }

    private static String requestedFolder(PluginCall call) {
        String folder = call.getString("folder");
        if (folder == null || folder.isEmpty() || hasControlChars(folder) || folder.length() > 255) {
            return "INBOX";
        }
        return folder;
    }

    // ── Méthodes exposées ─────────────────────────────────────────────────

    @PluginMethod
    public void addAccount(PluginCall call) {
        String scope = call.getString("scope");
        String provider = call.getString("provider", "imap");
        String label = call.getString("label", "");
        String host = call.getString("host");
        String email = call.getString("email");
        String password = call.getString("password");
        if (scope == null || scope.isEmpty()) {
            call.reject("invalid_input");
            return;
        }
        String validationError = validateAccountInput(host, email, password);
        if (validationError != null) {
            call.reject(validationError);
            return;
        }
        executor.execute(() -> {
            Store store = null;
            try {
                JSONArray accounts = loadAccounts(scope);
                if (accounts.length() >= MAX_ACCOUNTS_PER_SCOPE) {
                    call.reject("too_many_accounts");
                    return;
                }
                // Test de connexion réel AVANT toute écriture.
                store = connectStore(host, email, password);
                Folder inbox = store.getFolder("INBOX");
                inbox.open(Folder.READ_ONLY);
                int total = inbox.getMessageCount();
                closeQuietly(inbox);

                JSONObject account = new JSONObject();
                String id = UUID.randomUUID().toString();
                account.put("id", id);
                account.put("provider", provider);
                account.put("label", label);
                account.put("host", host);
                account.put("email", email);
                account.put("password", password);
                accounts.put(account);
                saveAccounts(scope, accounts);

                JSObject ret = new JSObject();
                ret.put("id", id);
                ret.put("messageCount", total);
                call.resolve(ret);
            } catch (AuthenticationFailedException e) {
                call.reject(authFailedCode(e));
            } catch (MessagingException e) {
                call.reject("connect_failed");
            } catch (Exception e) {
                call.reject("mail_error");
            } finally {
                closeQuietly(store);
            }
        });
    }

    @PluginMethod
    public void listAccounts(PluginCall call) {
        String scope = call.getString("scope");
        if (scope == null || scope.isEmpty()) {
            call.reject("invalid_input");
            return;
        }
        executor.execute(() -> {
            try {
                JSONArray accounts = loadAccounts(scope);
                JSArray out = new JSArray();
                for (int i = 0; i < accounts.length(); i++) {
                    JSONObject a = accounts.getJSONObject(i);
                    JSObject o = new JSObject();
                    o.put("id", a.optString("id"));
                    o.put("provider", a.optString("provider"));
                    o.put("label", a.optString("label"));
                    o.put("email", a.optString("email"));
                    o.put("host", a.optString("host"));
                    // JAMAIS le mot de passe.
                    out.put(o);
                }
                JSObject ret = new JSObject();
                ret.put("accounts", out);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("mail_error");
            }
        });
    }

    @PluginMethod
    public void removeAccount(PluginCall call) {
        String scope = call.getString("scope");
        String id = call.getString("id");
        if (scope == null || id == null) {
            call.reject("invalid_input");
            return;
        }
        executor.execute(() -> {
            try {
                JSONArray accounts = loadAccounts(scope);
                JSONArray kept = new JSONArray();
                for (int i = 0; i < accounts.length(); i++) {
                    JSONObject a = accounts.getJSONObject(i);
                    if (!id.equals(a.optString("id"))) kept.put(a);
                }
                saveAccounts(scope, kept);
                call.resolve();
            } catch (Exception e) {
                call.reject("mail_error");
            }
        });
    }

    @PluginMethod
    public void clearAccounts(PluginCall call) {
        String scope = call.getString("scope");
        if (scope == null || scope.isEmpty()) {
            call.reject("invalid_input");
            return;
        }
        executor.execute(() -> {
            // Chemin « suppression de compte » (RGPD) : commit() écrit de façon
            // synchrone et rend le succès, là où apply() renvoie la main sans
            // garantie. On ne veut pas annoncer un effacement qui n'a pas eu
            // lieu — le rejet fait remonter l'échec jusqu'à l'utilisateur.
            boolean ok = prefs().edit().remove(scopeKey(scope)).commit();
            if (ok) {
                call.resolve();
            } else {
                call.reject("clear_failed");
            }
        });
    }

    @PluginMethod
    public void checkAccount(PluginCall call) {
        withStore(call, (store, account) -> {
            Folder inbox = store.getFolder("INBOX");
            try {
                inbox.open(Folder.READ_ONLY);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("messageCount", inbox.getMessageCount());
                ret.put("unreadCount", inbox.getUnreadMessageCount());
                call.resolve(ret);
            } finally {
                closeQuietly(inbox);
            }
        });
    }

    @PluginMethod
    public void listFolders(PluginCall call) {
        withStore(call, (store, account) -> {
            Folder[] folders = store.getDefaultFolder().list("*");
            JSArray out = new JSArray();
            int count = 0;
            for (Folder f : folders) {
                if (count >= 50) break;
                if ((f.getType() & Folder.HOLDS_MESSAGES) == 0) continue;
                JSObject o = new JSObject();
                o.put("name", f.getFullName());
                out.put(o);
                count++;
            }
            JSObject ret = new JSObject();
            ret.put("folders", out);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void recentMessages(PluginCall call) {
        int limit = clampLimit(call);
        String folderName = requestedFolder(call);
        withStore(call, (store, account) -> {
            Folder folder = store.getFolder(folderName);
            try {
                folder.open(Folder.READ_ONLY);
                int total = folder.getMessageCount();
                int start = Math.max(1, total - limit + 1);
                Message[] messages = total > 0 ? folder.getMessages(start, total) : new Message[0];
                FetchProfile fp = new FetchProfile();
                fp.add(FetchProfile.Item.ENVELOPE);
                fp.add(UIDFolder.FetchProfileItem.UID);
                folder.fetch(messages, fp);
                JSArray out = new JSArray();
                // Du plus récent au plus ancien.
                for (int i = messages.length - 1; i >= 0; i--) {
                    out.put(messageSummary(folder, messages[i]));
                }
                JSObject ret = new JSObject();
                ret.put("messages", out);
                ret.put("total", total);
                call.resolve(ret);
            } finally {
                closeQuietly(folder);
            }
        });
    }

    @PluginMethod
    public void searchMessages(PluginCall call) {
        int limit = clampLimit(call);
        String folderName = requestedFolder(call);
        String query = call.getString("query");
        if (query == null || query.isEmpty() || query.length() > 128 || hasControlChars(query)) {
            call.reject("invalid_input");
            return;
        }
        withStore(call, (store, account) -> {
            Folder folder = store.getFolder(folderName);
            try {
                folder.open(Folder.READ_ONLY);
                Message[] found;
                try {
                    SearchTerm term = new OrTerm(new SearchTerm[]{
                            new SubjectTerm(query),
                            new FromStringTerm(query),
                            new BodyTerm(query),
                    });
                    found = folder.search(term);
                } catch (MessagingException serverSearchFailed) {
                    // Certains serveurs rejettent SEARCH avec des accents :
                    // repli client sur les N derniers messages (sujet/expéditeur).
                    int total = folder.getMessageCount();
                    int start = Math.max(1, total - SEARCH_FALLBACK_SCAN + 1);
                    Message[] recent = total > 0 ? folder.getMessages(start, total) : new Message[0];
                    FetchProfile fp = new FetchProfile();
                    fp.add(FetchProfile.Item.ENVELOPE);
                    folder.fetch(recent, fp);
                    String needle = query.toLowerCase(Locale.ROOT);
                    List<Message> matched = new ArrayList<>();
                    for (Message m : recent) {
                        String subject = m.getSubject() == null ? "" : decodeHeader(m.getSubject());
                        String from = formatAddresses(m.getFrom());
                        if (subject.toLowerCase(Locale.ROOT).contains(needle)
                                || from.toLowerCase(Locale.ROOT).contains(needle)) {
                            matched.add(m);
                        }
                    }
                    found = matched.toArray(new Message[0]);
                }
                FetchProfile fp = new FetchProfile();
                fp.add(FetchProfile.Item.ENVELOPE);
                fp.add(UIDFolder.FetchProfileItem.UID);
                int from = Math.max(0, found.length - limit);
                Message[] window = new Message[found.length - from];
                System.arraycopy(found, from, window, 0, window.length);
                folder.fetch(window, fp);
                JSArray out = new JSArray();
                for (int i = window.length - 1; i >= 0; i--) {
                    out.put(messageSummary(folder, window[i]));
                }
                JSObject ret = new JSObject();
                ret.put("messages", out);
                ret.put("totalMatches", found.length);
                call.resolve(ret);
            } finally {
                closeQuietly(folder);
            }
        });
    }

    @PluginMethod
    public void readMessage(PluginCall call) {
        String folderName = requestedFolder(call);
        Long uidRaw = call.getLong("uid");
        if (uidRaw == null || uidRaw < 0) {
            call.reject("invalid_input");
            return;
        }
        final long uid = uidRaw;
        withStore(call, (store, account) -> {
            Folder folder = store.getFolder(folderName);
            try {
                folder.open(Folder.READ_ONLY);
                if (!(folder instanceof UIDFolder)) {
                    call.reject("mail_error");
                    return;
                }
                Message msg = ((UIDFolder) folder).getMessageByUID(uid);
                if (msg == null) {
                    call.reject("message_not_found");
                    return;
                }
                JSObject o = messageSummary(folder, msg);
                o.put("to", formatAddresses(msg.getRecipients(Message.RecipientType.TO)));
                o.put("body", truncate(extractText(msg), MAX_BODY_CHARS));
                call.resolve(o);
            } finally {
                closeQuietly(folder);
            }
        });
    }
}
