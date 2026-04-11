package com.arty.app;

import android.content.Intent;
import android.util.Log;

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

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

@CapacitorPlugin(name = "GoogleSignInNative")
public class GoogleSignInPlugin extends Plugin {

    private static final String TAG = "GoogleSignInPlugin";
    private GoogleSignInClient googleSignInClient;
    private ActivityResultLauncher<Intent> signInLauncher;
    private PluginCall pendingCall;
    private String initError = null;

    @Override
    public void load() {
        try {
            String serverClientId = getContext().getString(
                getContext().getResources().getIdentifier(
                    "server_client_id", "string", getContext().getPackageName()
                )
            );
            Log.d(TAG, "server_client_id: " + serverClientId);

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
            Log.d(TAG, "GoogleSignInClient created OK");

            signInLauncher = bridge.getActivity().registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    Log.d(TAG, "ActivityResult received, resultCode=" + result.getResultCode());
                    if (pendingCall == null) {
                        Log.e(TAG, "pendingCall is null!");
                        return;
                    }
                    PluginCall call = pendingCall;
                    pendingCall = null;

                    try {
                        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(result.getData());
                        GoogleSignInAccount account = task.getResult(ApiException.class);
                        Log.d(TAG, "Sign-in success: " + account.getEmail());

                        String authCode = account.getServerAuthCode();
                        Log.d(TAG, "serverAuthCode present: " + (authCode != null && !authCode.isEmpty()));

                        JSObject ret = new JSObject();
                        ret.put("email", account.getEmail() != null ? account.getEmail() : "");
                        ret.put("name", account.getDisplayName() != null ? account.getDisplayName() : "");
                        ret.put("avatar", account.getPhotoUrl() != null ? account.getPhotoUrl().toString() : "");
                        ret.put("serverAuthCode", authCode != null ? authCode : "");
                        call.resolve(ret);
                    } catch (ApiException e) {
                        Log.e(TAG, "ApiException: " + e.getStatusCode());
                        call.reject("Google Sign-In erreur: " + e.getStatusCode(), String.valueOf(e.getStatusCode()));
                    }
                }
            );
            Log.d(TAG, "ActivityResultLauncher registered OK");

        } catch (Exception e) {
            Log.e(TAG, "load() FAILED: " + e.getMessage(), e);
            initError = e.getMessage();
        }
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        Log.d(TAG, "signIn() called");

        if (initError != null) {
            call.reject("Plugin init failed: " + initError);
            return;
        }
        if (signInLauncher == null) {
            call.reject("signInLauncher is null");
            return;
        }
        if (googleSignInClient == null) {
            call.reject("googleSignInClient is null");
            return;
        }

        try {
            pendingCall = call;
            bridge.saveCall(call);
            Log.d(TAG, "Launching sign-in intent...");
            signInLauncher.launch(googleSignInClient.getSignInIntent());
            Log.d(TAG, "Intent launched OK");
        } catch (Exception e) {
            Log.e(TAG, "signIn() FAILED: " + e.getMessage(), e);
            call.reject("Launch failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        if (googleSignInClient != null) {
            googleSignInClient.signOut().addOnCompleteListener(task -> call.resolve());
        } else {
            call.resolve();
        }
    }
}
