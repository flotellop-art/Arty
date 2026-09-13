package com.arty.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.Bundle;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.provider.Telephony;
import android.text.InputFilter;
import android.view.WindowManager;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.core.content.ContextCompat;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native-only viewer. No WebView, network, intents carrying content, or storage.
 * Reads never mark messages as read; SMS/RCS/MMS are not conflated.
 */
public class LocalSmsActivity extends Activity {
    private final LocalSmsSession session = LocalSmsSession.INSTANCE;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Runnable sessionChanged = () -> ui.post(() -> { if (!authorized()) { clear(); finish(); } });
    private String token;
    private LinearLayout messages;
    private TextView status;
    private EditText search;
    private CancellationSignal query;
    private int generation;
    private boolean foreground;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(null); // Never restore SMS/search from Android saved state.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        token = getIntent().getStringExtra("sessionToken");
        if (!authorized()) { finish(); return; }
        session.observe(sessionChanged);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        root.setPadding(padding, padding, padding, padding);
        root.setFitsSystemWindows(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) root.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        root.setSaveEnabled(false);
        TextView heading = label(getString(R.string.sms_title)); heading.setTextSize(24); root.addView(heading);
        root.addView(label(getString(R.string.sms_local_notice)));
        Button close = new Button(this); close.setText(R.string.sms_close); close.setOnClickListener(v -> finish()); root.addView(close);
        search = new EditText(this);
        search.setHint(R.string.sms_search_hint);
        search.setContentDescription(getString(R.string.sms_search_hint));
        search.setSingleLine(true); search.setSaveEnabled(false);
        search.setFilters(new InputFilter[]{ new InputFilter.LengthFilter(100) });
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) search.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        root.addView(search);
        Button find = new Button(this); find.setText(R.string.sms_search); find.setOnClickListener(v -> read()); root.addView(find);
        Button revoke = new Button(this); revoke.setText(R.string.sms_revoke);
        revoke.setOnClickListener(v -> { clear(); session.decide(token, LocalSmsSession.Decision.DECLINED); finish(); }); root.addView(revoke);
        status = label(""); root.addView(status);
        ScrollView scroll = new ScrollView(this);
        messages = new LinearLayout(this); messages.setOrientation(LinearLayout.VERTICAL); messages.setSaveEnabled(false);
        scroll.addView(messages); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }
    private TextView label(String text) {
        TextView view = new TextView(this); view.setText(text); view.setTextSize(16);
        view.setPadding(0, 12, 0, 12); view.setSaveEnabled(false);
        // Plain text only: no auto-links, HTML, clipboard or export action.
        return view;
    }
    private boolean authorized() {
        return BuildConfig.LOCAL_SMS_ENABLED && session.allowed(token) &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED;
    }
    @Override protected void onResume() {
        super.onResume(); foreground = true;
        if (!authorized()) { finish(); return; }
        if (messages != null) read();
    }
    @Override protected void onPause() {
        foreground = false; clear(); super.onPause();
    }
    @Override protected void onDestroy() {
        session.removeObserver(sessionChanged); clear(); worker.shutdownNow(); super.onDestroy();
    }
    @Override protected void onSaveInstanceState(Bundle outState) {
        // Deliberately do not serialize the view hierarchy or search term.
    }
    private void clear() {
        generation++;
        if (query != null) { query.cancel(); query = null; }
        if (messages != null) messages.removeAllViews();
        if (search != null) search.setText("");
        if (status != null) status.setText("");
    }
    private void read() {
        if (!foreground || !authorized()) { clear(); finish(); return; }
        String pattern = LocalSmsQuery.search(search.getText().toString());
        if (query != null) query.cancel();
        CancellationSignal cancellation = new CancellationSignal(); query = cancellation;
        int ticket = ++generation;
        messages.removeAllViews(); status.setText(R.string.sms_loading);
        Runnable timeout = cancellation::cancel;
        ui.postDelayed(timeout, 5000);
        worker.execute(() -> {
            List<String> rows = new ArrayList<>();
            boolean more = false;
            int error = 0;
            try {
                cancellation.throwIfCanceled();
                if (!authorized()) throw new SecurityException();
                String selection = "date >= ? AND (body LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\')";
                String[] args = { Long.toString(System.currentTimeMillis() - LocalSmsQuery.WINDOW_MS), pattern, pattern };
                try (Cursor cursor = getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI,
                        new String[]{ "address", "date", "body" }, selection, args, "date DESC", cancellation)) {
                    if (cursor == null) throw new IllegalStateException();
                    DateFormat dateFormat = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT);
                    while (cursor.moveToNext()) {
                        cancellation.throwIfCanceled();
                        if (!authorized()) throw new SecurityException();
                        if (rows.size() == LocalSmsQuery.LIMIT) { more = true; break; }
                        rows.add(LocalSmsQuery.bounded(cursor.getString(0), 100) + " · " +
                            dateFormat.format(new Date(cursor.getLong(1))) + "\n" + LocalSmsQuery.bounded(cursor.getString(2), LocalSmsQuery.BODY_LIMIT));
                    }
                }
            } catch (SecurityException denied) { error = R.string.sms_denied; }
            catch (RuntimeException unavailable) { error = R.string.sms_unavailable; }
            ui.removeCallbacks(timeout);
            final int failure = error; final boolean limited = more;
            ui.post(() -> {
                if (!foreground || ticket != generation) { rows.clear(); return; }
                if (!authorized()) { rows.clear(); clear(); finish(); return; }
                if (failure != 0 || cancellation.isCanceled()) {
                    status.setText(failure != 0 ? failure : R.string.sms_unavailable);
                } else {
                    status.setText(rows.isEmpty() ? getString(R.string.sms_empty) : getString(limited ? R.string.sms_limited : R.string.sms_count, rows.size()));
                    for (String row : rows) messages.addView(label(row));
                }
                rows.clear();
            });
        });
    }
}
