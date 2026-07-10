import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithTimeout, HttpTimeoutError } from "./http-timeout";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("aborts a fetch that exceeds its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));

    const request = fetchWithTimeout("https://example.test", {}, 50);
    const assertion = expect(request).rejects.toBeInstanceOf(HttpTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});
