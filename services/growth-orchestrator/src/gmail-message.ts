const MAX_EMAIL_LENGTH = 320;
const MAX_SUBJECT_LENGTH = 255;
const MAX_BODY_LENGTH = 100_000;
const MAX_REFERENCE_LENGTH = 998;
const CHUNK_SIZE = 8192;

export class GmailMessageValidationError extends Error {}

function assertSingleLine(label: string, value: string, maxLength: number): void {
  if (/\r|\n/.test(value)) {
    throw new GmailMessageValidationError(`${label} contient un retour a la ligne interdit.`);
  }
  if (value.length > maxLength) {
    throw new GmailMessageValidationError(`${label} depasse ${maxLength} caracteres.`);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;

  // Un encoded-word RFC 2047 ne doit pas depasser 75 caracteres. Des blocs
  // de 36 octets produisent au plus 60 caracteres avec l'enveloppe UTF-8/B.
  const chunks: string[] = [];
  let current = "";
  for (const char of subject) {
    const candidate = current + char;
    if (current && new TextEncoder().encode(candidate).length > 36) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks
    .map((chunk) => `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(chunk))}?=`)
    .join("\r\n ");
}

export function encodeBase64UrlUtf8(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface Rfc2822MessageInput {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

/** Construit un message RFC 2822 avec separation headers/body explicite. */
export function buildRfc2822Message(input: Rfc2822MessageInput): string {
  const to = input.to.trim();
  const subject = input.subject.trim();

  assertSingleLine("Le destinataire", to, MAX_EMAIL_LENGTH);
  assertSingleLine("Le sujet", subject, MAX_SUBJECT_LENGTH);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) {
    throw new GmailMessageValidationError("Le destinataire n'est pas une adresse email valide.");
  }
  if (!subject) {
    throw new GmailMessageValidationError("Le sujet est obligatoire.");
  }
  if (input.body.length > MAX_BODY_LENGTH) {
    throw new GmailMessageValidationError(`Le corps depasse ${MAX_BODY_LENGTH} caracteres.`);
  }

  const headers = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ];

  if (input.inReplyTo) {
    assertSingleLine("In-Reply-To", input.inReplyTo, MAX_REFERENCE_LENGTH);
    headers.push(`In-Reply-To: ${input.inReplyTo}`);
  }
  if (input.references) {
    assertSingleLine("References", input.references, MAX_REFERENCE_LENGTH);
    headers.push(`References: ${input.references}`);
  }

  return `${headers.join("\r\n")}\r\n\r\n${input.body}`;
}

export function appendReference(existing: string, messageId: string): string {
  const newest = messageId.trim();
  const previous = existing.trim().replace(/\s+/g, " ");
  if (!previous) return newest.slice(0, MAX_REFERENCE_LENGTH);
  if (!newest) return previous.slice(-MAX_REFERENCE_LENGTH);

  const availableForPrevious = Math.max(0, MAX_REFERENCE_LENGTH - newest.length - 1);
  let keptPrevious = previous;
  if (keptPrevious.length > availableForPrevious) {
    keptPrevious = availableForPrevious > 0 ? keptPrevious.slice(-availableForPrevious) : "";
    const firstSpace = keptPrevious.indexOf(" ");
    keptPrevious = firstSpace >= 0 ? keptPrevious.slice(firstSpace + 1) : "";
  }
  return keptPrevious ? `${keptPrevious} ${newest}` : newest.slice(-MAX_REFERENCE_LENGTH);
}
