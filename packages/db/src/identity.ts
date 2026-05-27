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
      .returning({ id: schema.users.id });
    if (!created) throw new Error("Failed to create user");
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
    .returning({ id: schema.users.id });
  if (!created) throw new Error("Failed to create local owner user");
  return created.id;
}
