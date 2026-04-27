package com.arty.app;

import android.content.Intent;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GoogleSignInPlugin.class);
        registerPlugin(AudioBeepMutePlugin.class);
        registerPlugin(ShareTargetPlugin.class);
        registerPlugin(WidgetIntentPlugin.class);
        super.onCreate(savedInstanceState);

        // Edge-to-edge — fait passer la WebView sous les system bars (status
        // bar en haut, navigation bar en bas). Sans ça, sur certains téléphones
        // (DPR 3.5, grand clavier), la WebView se faisait shrink à 138 CSS px
        // quand le clavier ouvrait — TopBar + InputBar prenaient à eux seuls
        // tout cet espace et le contenu collapse.
        // Le contenu HTML utilise déjà `viewport-fit=cover` + `safe-area-inset-*`
        // pour respecter visuellement les system bars, et `--kb-height` settée
        // par main.tsx via visualViewport gère le clavier en CSS.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Relay shared content to ShareTargetPlugin when the app is already
        // in memory (singleTask launchMode → cold start uses load() instead).
        PluginHandle shareHandle = getBridge().getPlugin("ShareTarget");
        if (shareHandle != null && shareHandle.getInstance() instanceof ShareTargetPlugin) {
            ((ShareTargetPlugin) shareHandle.getInstance()).handleNewIntent(intent);
        }

        // Same relay for widget-launched intents.
        PluginHandle widgetHandle = getBridge().getPlugin("WidgetIntent");
        if (widgetHandle != null && widgetHandle.getInstance() instanceof WidgetIntentPlugin) {
            ((WidgetIntentPlugin) widgetHandle.getInstance()).handleNewIntent(intent);
        }
    }
}
