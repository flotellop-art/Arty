package com.arty.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public class ArtyWidgetProvider extends AppWidgetProvider {

    public static final String ACTION_OPEN_FROM_WIDGET = "com.arty.app.WIDGET_OPEN";
    public static final String EXTRA_WIDGET_SOURCE = "widget_source";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            try {
                updateOne(context, appWidgetManager, appWidgetId);
            } catch (Exception e) {
                // Defensive: never let onUpdate throw, otherwise the widget
                // freezes silently and the user sees a stale layout.
                android.util.Log.w("ArtyWidget", "updateOne failed", e);
            }
        }
    }

    private void updateOne(Context context, AppWidgetManager mgr, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_arty);

        Intent launch = new Intent(context, MainActivity.class);
        launch.setAction(ACTION_OPEN_FROM_WIDGET);
        launch.putExtra(EXTRA_WIDGET_SOURCE, "tap_zone");
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        // FLAG_IMMUTABLE required on Android 12+. FLAG_UPDATE_CURRENT to refresh extras.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(context, appWidgetId, launch, flags);

        views.setOnClickPendingIntent(R.id.widget_root, pi);

        mgr.updateAppWidget(appWidgetId, views);
    }

    /**
     * Public helper for refreshing all widget instances from the JS layer
     * (e.g. after a sync, or to force a re-render). V1 doesn't use it but
     * the plumbing is here for V1.5+.
     */
    public static void refreshAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName cn = new ComponentName(context, ArtyWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(cn);
        if (ids != null && ids.length > 0) {
            Intent intent = new Intent(context, ArtyWidgetProvider.class);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            context.sendBroadcast(intent);
        }
    }
}
