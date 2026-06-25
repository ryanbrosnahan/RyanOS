import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

export type RyanOsAuthMode = "required" | "dev-local";

export function csvValues(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function authModeFromEnv(): RyanOsAuthMode {
  const configured = process.env.RYANOS_AUTH_MODE?.trim();
  if (configured === "required" || configured === "dev-local") return configured;
  return process.env.NODE_ENV === "production" ? "required" : "dev-local";
}

export function trustedAuthOrigins(): string[] {
  const configured = csvValues(process.env.RYANOS_CORS_ORIGINS);
  if (configured.length > 0) return configured;
  return ["http://localhost:3100", "http://127.0.0.1:3100"];
}

function inviteCodes(): Set<string> {
  return new Set(csvValues(process.env.RYANOS_INVITE_CODES));
}

export function createRyanOsAuth(pool: unknown) {
  return betterAuth({
    appName: "RyanOS",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    basePath: "/auth",
    trustedOrigins: trustedAuthOrigins(),
    database: pool as never,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      requireEmailVerification: false,
      minPasswordLength: 12
    },
    advanced: {
      useSecureCookies: process.env.RYANOS_AUTH_SECURE_COOKIES === "true",
      database: {
        generateId: () => crypto.randomUUID()
      }
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;

        const allowedCodes = inviteCodes();
        const inviteCode = ctx.headers?.get("x-ryanos-invite-code")?.trim();
        if (allowedCodes.size === 0 && process.env.NODE_ENV !== "production") return;
        if (!inviteCode || !allowedCodes.has(inviteCode)) {
          throw new APIError("FORBIDDEN", {
            message: "A valid RyanOS invite code is required."
          });
        }
      })
    }
  });
}
