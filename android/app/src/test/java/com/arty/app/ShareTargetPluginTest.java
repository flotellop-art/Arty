package com.arty.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.io.ByteArrayInputStream;

import org.junit.Test;

public class ShareTargetPluginTest {
    @Test
    public void imagesUse32MiBWhilePdfAndUnknownStayAt10MiB() {
        assertEquals(32L * 1024 * 1024, ShareTargetPlugin.maxFileSizeBytes("image/jpeg"));
        assertEquals(32L * 1024 * 1024, ShareTargetPlugin.maxFileSizeBytes("image/*"));
        assertEquals(10L * 1024 * 1024, ShareTargetPlugin.maxFileSizeBytes("application/pdf"));
        assertEquals(10L * 1024 * 1024, ShareTargetPlugin.maxFileSizeBytes(null));
    }

    @Test
    public void genericResolverMimeFallsBackToIntentThenFilename() {
        assertEquals(
            "image/*",
            ShareTargetPlugin.resolveMimeType("application/octet-stream", "image/*", "shared")
        );
        assertEquals(
            "image/jpeg",
            ShareTargetPlugin.resolveMimeType("application/octet-stream", null, "photo.JPG")
        );
        assertEquals(
            "application/pdf",
            ShareTargetPlugin.resolveMimeType(null, null, "devis.pdf")
        );
    }

    @Test
    public void cappedReadAcceptsTheExactLimitAndRejectsTheNextByte() throws Exception {
        assertArrayEquals(
            new byte[] {1, 2, 3},
            ShareTargetPlugin.readAllCapped(new ByteArrayInputStream(new byte[] {1, 2, 3}), 3)
        );
        assertNull(
            ShareTargetPlugin.readAllCapped(new ByteArrayInputStream(new byte[] {1, 2, 3, 4}), 3)
        );
    }
}
