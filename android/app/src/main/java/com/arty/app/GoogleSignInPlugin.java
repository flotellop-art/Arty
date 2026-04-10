package com.arty.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Task;

import androidx.activity.result.ActivityResult;

@CapacitorPlugin(name = "GoogleSignInNative")
public class GoogleSignInPlugin extends Plugin {

    private GoogleSignInClient googleSignInClient;

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
                .requestServerAuthCode(serverClientId)
                .build();

        googleSignInClient = GoogleSignIn.getClient(getActivity(), gso);
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        Intent signInIntent = googleSignInClient.getSignInIntent();
        startActivityForResult(call, signInIntent, "handleSignInResult");
    }

    @ActivityCallback
    private void handleSignInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        try {
            Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(result.getData());
            GoogleSignInAccount account = task.getResult(ApiException.class);

            JSObject ret = new JSObject();
            ret.put("email", account.getEmail());
            ret.put("name", account.getDisplayName() != null ? account.getDisplayName() : "");
            ret.put("avatar", account.getPhotoUrl() != null ? account.getPhotoUrl().toString() : "");
            ret.put("serverAuthCode", account.getServerAuthCode());

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
