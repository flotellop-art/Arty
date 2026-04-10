package com.arty.app;

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
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Task;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

@CapacitorPlugin(name = "GoogleSignInNative")
public class GoogleSignInPlugin extends Plugin {

    private GoogleSignInClient googleSignInClient;
    private PluginCall pendingCall;
    private ActivityResultLauncher<Intent> signInLauncher;

    @Override
    public void load() {
        String serverClientId = getContext().getString(
            getContext().getResources().getIdentifier("server_client_id", "string", getContext().getPackageName())
        );

        GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestProfile()
                .requestServerAuthCode(serverClientId)
                .requestScopes(
                    new Scope("https://www.googleapis.com/auth/gmail.readonly"),
                    new Scope("https://www.googleapis.com/auth/gmail.send"),
                    new Scope("https://www.googleapis.com/auth/gmail.modify"),
                    new Scope("https://www.googleapis.com/auth/drive"),
                    new Scope("https://www.googleapis.com/auth/calendar"),
                    new Scope("https://www.googleapis.com/auth/calendar.events"),
                    new Scope("https://www.googleapis.com/auth/contacts")
                )
                .build();

        googleSignInClient = GoogleSignIn.getClient(getActivity(), gso);

        signInLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            new ActivityResultCallback<ActivityResult>() {
                @Override
                public void onActivityResult(ActivityResult result) {
                    handleSignInResult(result);
                }
            }
        );
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        pendingCall = call;
        Intent signInIntent = googleSignInClient.getSignInIntent();
        signInLauncher.launch(signInIntent);
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        googleSignInClient.signOut().addOnCompleteListener(task -> {
            call.resolve();
        });
    }

    private void handleSignInResult(ActivityResult result) {
        if (pendingCall == null) return;

        try {
            Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(result.getData());
            GoogleSignInAccount account = task.getResult(ApiException.class);

            JSObject ret = new JSObject();
            ret.put("email", account.getEmail());
            ret.put("name", account.getDisplayName() != null ? account.getDisplayName() : "");
            ret.put("avatar", account.getPhotoUrl() != null ? account.getPhotoUrl().toString() : "");
            ret.put("serverAuthCode", account.getServerAuthCode());

            pendingCall.resolve(ret);
        } catch (ApiException e) {
            pendingCall.reject("Google Sign-In failed", String.valueOf(e.getStatusCode()));
        }
        pendingCall = null;
    }
}
