import { afterEach, describe, expect, it, vi } from "vitest";

import { BodyReadTimeoutError, BodyTooLargeError, readTextBodyLimited } from "./bounded-body";

afterEach(() => {
  vi.useRealTimers();
});

describe("readTextBodyLimited", () => {
  it("preserves UTF-8 across streamed chunks", async () => {
    const encoded = new TextEncoder().encode("déjà prêt");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.subarray(0, 3));
        controller.enqueue(encoded.subarray(3));
        controller.close();
      },
    });

    await expect(readTextBodyLimited(new Response(stream), 100)).resolves.toBe("déjà prêt");
  });

  it("rejects an oversized declared length before reading", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull: vi.fn(),
    });
    const response = new Response(stream, { headers: { "Content-Length": "101" } });

    await expect(readTextBodyLimited(response, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("stops a chunked body as soon as it exceeds the limit", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60));
        controller.enqueue(new Uint8Array(60));
      },
      cancel,
    });

    await expect(readTextBodyLimited(new Response(stream), 100)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels a body that stalls after the headers", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });

    const reading = readTextBodyLimited(new Response(stream), 100, 50);
    const assertion = expect(reading).rejects.toBeInstanceOf(BodyReadTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });
});
