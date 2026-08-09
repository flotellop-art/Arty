package com.arty.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class MailImapPluginTest {

    // BUG 66 : l'espace (0x20) et les blancs Unicode (U+00A0…) doivent PASSER
    // la validation — les rejeter casserait des mots de passe IMAP légitimes.
    // La normalisation des mots de passe d'application vit côté TS.
    @Test
    public void passwordsWithSpacesPassValidation() {
        assertNull(MailImapPlugin.validateAccountInput(
                "imap.gmail.com", "a@b.fr", "abcd efgh ijkl mnop"));
        assertNull(MailImapPlugin.validateAccountInput(
                "imap.gmail.com", "a@b.fr", "abcd efgh"));
    }

    @Test
    public void passwordsWithControlCharsAreRejected() {
        assertEquals("invalid_password", MailImapPlugin.validateAccountInput(
                "imap.gmail.com", "a@b.fr", "secret\n"));
        assertEquals("invalid_password", MailImapPlugin.validateAccountInput(
                "imap.gmail.com", "a@b.fr", "sec\tret"));
    }

    // BUG 64 : la réponse serveur remonte sanitisée — une ligne, bornée,
    // sans caractères de contrôle, jamais null.
    @Test
    public void sanitizeServerMessageStripsControlCharsAndCaps() {
        assertEquals("", MailImapPlugin.sanitizeServerMessage(null));
        assertEquals(
                "Invalid credentials (Failure)",
                MailImapPlugin.sanitizeServerMessage("Invalid credentials (Failure)\r\n"));
        assertEquals(
                "line one line two",
                MailImapPlugin.sanitizeServerMessage("line one\r\nline two"));
        StringBuilder longMsg = new StringBuilder();
        for (int i = 0; i < 300; i++) longMsg.append('x');
        assertEquals(200, MailImapPlugin.sanitizeServerMessage(longMsg.toString()).length());
    }

    @Test
    public void authFailedCodeKeepsBareCodeWhenNoDetail() {
        assertEquals("auth_failed", MailImapPlugin.authFailedCode(new Exception()));
        assertEquals(
                "auth_failed: Invalid credentials",
                MailImapPlugin.authFailedCode(new Exception("Invalid credentials")));
    }
}
