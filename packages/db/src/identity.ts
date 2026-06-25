import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { UUID } from "@ryanos/shared";
import * as schema from "./schema.js";

export type RyanDb = NodePgDatabase<typeof schema>;

const localOwnerEmail = "local-owner@ryanos.local";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined): value is UUID {
  return typeof value === "string" && uuidPattern.test(value);
}

export type AuthenticatedUserIdentity = {
  authUserId: string;
  email: string;
  displayName?: string | null;
};

export type UserEmailIdentity = {
  email: string;
  displayName?: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function displayNameForIdentity(identity: UserEmailIdentity): string {
  const trimmed = identity.displayName?.trim();
  if (trimmed) return trimmed;
  return normalizeEmail(identity.email);
}

export async function resolveUserId(db: RyanDb, userId: UUID): Promise<UUID> {
  if (isUuid(userId)) {
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.id, userId)
    });
    if (existing) return existing.id;

    const [created] = await db
      .insert(schema.users)
      .values({
        id: userId,
        email: `${userId}@ryanos.local`,
        displayName: userId
      })
      .onConflictDoNothing({
        target: schema.users.id
      })
      .returning({ id: schema.users.id });
    if (!created) {
      const conflicted = await db.query.users.findFirst({
        where: eq(schema.users.id, userId)
      });
      if (!conflicted) throw new Error("User insert conflicted but existing row was not found");
      return conflicted.id;
    }
    return created.id;
  }

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, localOwnerEmail)
  });
  if (existing) return existing.id;

  const [created] = await db
    .insert(schema.users)
    .values({
      email: localOwnerEmail,
      displayName: "Local Owner"
    })
    .onConflictDoNothing({
      target: schema.users.email
    })
    .returning({ id: schema.users.id });
  if (!created) {
    const conflicted = await db.query.users.findFirst({
      where: eq(schema.users.email, localOwnerEmail)
    });
    if (!conflicted) {
      throw new Error("Local owner insert conflicted but existing row was not found");
    }
    return conflicted.id;
  }
  return created.id;
}

export async function resolveAuthenticatedUserId(
  db: RyanDb,
  identity: AuthenticatedUserIdentity
): Promise<UUID> {
  const email = normalizeEmail(identity.email);
  const displayName = displayNameForIdentity(identity);

  const byAuthId = await db.query.users.findFirst({
    where: eq(schema.users.authUserId, identity.authUserId)
  });
  if (byAuthId) return byAuthId.id;

  const byEmail = await db.query.users.findFirst({
    where: eq(schema.users.email, email)
  });
  if (byEmail) {
    const [updated] = await db
      .update(schema.users)
      .set({
        authUserId: identity.authUserId,
        displayName,
        updatedAt: new Date()
      })
      .where(eq(schema.users.id, byEmail.id))
      .returning({ id: schema.users.id });
    return (updated?.id ?? byEmail.id) as UUID;
  }

  const [created] = await db
    .insert(schema.users)
    .values({
      authUserId: identity.authUserId,
      email,
      displayName
    })
    .returning({ id: schema.users.id });
  if (!created) throw new Error("Failed to create RyanOS user for authenticated account");
  return created.id;
}

export async function resolveUserIdByEmail(db: RyanDb, identity: UserEmailIdentity): Promise<UUID> {
  const email = normalizeEmail(identity.email);
  const displayName = displayNameForIdentity(identity);

  const byEmail = await db.query.users.findFirst({
    where: eq(schema.users.email, email)
  });
  if (byEmail) {
    if (byEmail.displayName !== displayName) {
      await db
        .update(schema.users)
        .set({
          displayName,
          updatedAt: new Date()
        })
        .where(eq(schema.users.id, byEmail.id));
    }
    return byEmail.id;
  }

  const [created] = await db
    .insert(schema.users)
    .values({
      email,
      displayName
    })
    .returning({ id: schema.users.id });
  if (!created) throw new Error("Failed to create RyanOS user for email identity");
  return created.id;
}
