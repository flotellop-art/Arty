import { describe, expect, it } from "vitest";

import {
  appendReference,
  buildRfc2822Message,
  encodeBase64UrlUtf8,
  GmailMessageValidationError,
} from "./gmail-message";

function decodeBase64UrlUtf8(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe("buildRfc2822Message", () => {
  it("preserves the mandatory blank line and UTF-8 body", () => {
    const raw = buildRfc2822Message({
      to: "florent@example.com",
      subject: "Réponse Arty",
      body: "Bonjour, déjà prêt.",
    });

    expect(raw).toContain("\r\n\r\nBonjour, déjà prêt.");
    expect(decodeBase64UrlUtf8(encodeBase64UrlUtf8(raw))).toBe(raw);
  });

  it.each([
    { to: "victim@example.com\r\nBcc: attacker@example.com", subject: "Sujet" },
    { to: "victim@example.com", subject: "Sujet\r\nBcc: attacker@example.com" },
  ])("rejects CRLF header injection", ({ to, subject }) => {
    expect(() => buildRfc2822Message({ to, subject, body: "test" }))
      .toThrow(GmailMessageValidationError);
  });

  it("uses real RFC message identifiers for replies", () => {
    const raw = buildRfc2822Message({
      to: "florent@example.com",
      subject: "Re: Test",
      body: "Réponse",
      inReplyTo: "<original@example.com>",
      references: "<root@example.com> <original@example.com>",
    });

    expect(raw).toContain("In-Reply-To: <original@example.com>\r\n");
    expect(raw).toContain("References: <root@example.com> <original@example.com>\r\n");
  });

  it("folds long non-ASCII subjects into valid encoded words", () => {
    const raw = buildRfc2822Message({
      to: "florent@example.com",
      subject: "Réponse détaillée ".repeat(10) + "été",
      body: "Test",
    });
    const encodedWords = raw.match(/=\?UTF-8\?B\?[^?]+\?=/g) ?? [];
    expect(encodedWords.length).toBeGreaterThan(1);
    expect(encodedWords.every((word) => word.length <= 75)).toBe(true);
  });

  it("keeps the newest message id when references must be shortened", () => {
    const references = appendReference(`<old@example.com> ${"x".repeat(990)}`, "<new@example.com>");
    expect(references.length).toBeLessThanOrEqual(998);
    expect(references).toMatch(/<new@example\.com>$/);
  });
});
