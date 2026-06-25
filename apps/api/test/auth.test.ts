import { describe, expect, it, vi, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

describe("auth mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the local owner in dev-local mode", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp({ authMode: "dev-local" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/me"
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      authMode: "dev-local",
      user: {
        id: "local-owner",
        email: "local-owner@ryanos.local"
      }
    });
  });

  it("rejects protected routes when required auth has no database", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp({ authMode: "required" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/me"
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: "Authentication is required but not configured."
    });
  });
});
