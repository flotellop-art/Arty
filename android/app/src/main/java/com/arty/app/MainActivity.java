package com.arty.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GoogleSignInPlugin.class);
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
}
