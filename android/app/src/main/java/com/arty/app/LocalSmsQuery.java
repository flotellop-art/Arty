package com.arty.app;

/** Fixed resource budget, shared by the native reader and unit tests. */
final class LocalSmsQuery {
    static final int LIMIT = 50;
    static final int BODY_LIMIT = 4000;
    static final long WINDOW_MS = 7L * 24 * 60 * 60 * 1000;
    static String search(String input) {
        String value = input == null ? "" : input.trim();
        if (value.length() > 100) throw new IllegalArgumentException("sms_query_too_long");
        return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }
    static String bounded(String text, int limit) {
        if (text == null) return "";
        return text.length() <= limit ? text : text.substring(0, limit) + "…";
    }
}
