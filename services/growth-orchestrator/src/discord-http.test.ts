import { afterEach, describe, expect, it, vi } from "vitest";

import { discordFetchOrThrow } from "./discord-http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discordFetchOrThrow", () => {
  it("fails immediately on a non-retryable 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discordFetchOrThrow("https://discord.test", {}, "post", {
      sleep: vi.fn(),
    })).rejects.toThrow("post failed (400)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 0 }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discordFetchOrThrow("https://discord.test", {}, "post", {
      sleep: vi.fn().mockResolvedValue(undefined),
    })).resolves.toHaveProperty("status", 204);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails instead of retrying before Discord's requested delay", async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { "Retry-After": "3600" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discordFetchOrThrow("https://discord.test", { method: "POST" }, "post", {
      sleep: sleepMock,
    })).rejects.toThrow("rate limited beyond retry budget");
    expect(sleepMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an ambiguous POST network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection reset"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discordFetchOrThrow("https://discord.test", { method: "POST" }, "post", {
      sleep: vi.fn(),
    })).rejects.toThrow("network failure");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails after bounded retries on repeated 500 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discordFetchOrThrow("https://discord.test", {}, "post", {
      sleep: vi.fn().mockResolvedValue(undefined),
    })).rejects.toThrow("post failed (500)");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
