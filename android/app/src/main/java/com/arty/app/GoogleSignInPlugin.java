package com.arty.app;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;

@CapacitorPlugin(name = "GoogleSignInNative")
public class GoogleSignInPlugin extends Plugin {

    private static final int RC_SIGN_IN = 9001;
    private GoogleSignInClient googleSignInClient;
    private PluginCall savedCall;

    @Override
    public void load() {
        String serverClientId = getContext().getString(
            getContext().getResources().getIdentifier(
                "server_client_id", "string", getContext().getPackageName()
            )
        );

        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestProfile()
                .requestIdToken(serverClientId)
                .build();

        googleSignInClient = GoogleSignIn.getClient(getActivity(), gso);
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        savedCall = call;
        bridge.saveCall(call);
        Intent signInIntent = googleSignInClient.getSignInIntent();
        getActivity().startActivityForResult(signInIntent, RC_SIGN_IN);
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);

        if (requestCode != RC_SIGN_IN || savedCall == null) return;

        PluginCall call = savedCall;
        savedCall = null;

        if (resultCode == Activity.RESULT_CANCELED) {
            call.reject("Connexion annulée", "CANCELLED");
            return;
        }

        try {
            Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
            GoogleSignInAccount account = task.getResult(ApiException.class);

            JSObject ret = new JSObject();
            ret.put("email", account.getEmail());
            ret.put("name", account.getDisplayName() != null ? account.getDisplayName() : "");
            ret.put("avatar", account.getPhotoUrl() != null ? account.getPhotoUrl().toString() : "");
            ret.put("serverAuthCode", account.getIdToken() != null ? account.getIdToken() : "");

            call.resolve(ret);
        } catch (ApiException e) {
            call.reject("Google Sign-In failed: " + e.getStatusCode(), String.valueOf(e.getStatusCode()));
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        googleSignInClient.signOut().addOnCompleteListener(task -> {
            call.resolve();
        });
    }
}
