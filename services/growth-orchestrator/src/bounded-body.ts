export class BodyTooLargeError extends Error {}
export class BodyReadTimeoutError extends Error {}

interface BodySource {
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

/** Lit un corps HTTP et interrompt le flux des que `maxBytes` est depasse. */
export async function readTextBodyLimited(
  source: BodySource,
  maxBytes: number,
  timeoutMs = 8_000,
): Promise<string> {
  const declaredLength = source.headers.get("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new BodyTooLargeError(`Body exceeds ${maxBytes} bytes`);
  }
  if (!source.body) return "";

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const timeoutError = new BodyReadTimeoutError(`Body read timed out after ${timeoutMs} ms`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(timeoutError), timeoutMs);
  });

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel("body too large");
        } catch {
          // La limite est deja appliquee ; l'echec de cancel ne change rien.
        }
        throw new BodyTooLargeError(`Body exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error === timeoutError) {
      try {
        await reader.cancel("body read timeout");
      } catch {
        // Le timeout reste l'erreur principale.
      }
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJsonBodyLimited<T>(
  source: BodySource,
  maxBytes: number,
  timeoutMs = 8_000,
): Promise<T> {
  return JSON.parse(await readTextBodyLimited(source, maxBytes, timeoutMs)) as T;
}
