import { eq, inArray } from "drizzle-orm";
import type { SqliteDb } from "../../db/db";
import { profile } from "../../db/schema";
import { asArray, type OneOrMany } from "../helpers";

export const DEFAULT_PROFILE_ID = "personal";

export type Profile = {
  id: string;
  name: string;
  model: string | null;
  createdAt: number;
};

export type ProfilePatch = {
  name?: string;
  model?: string | null;
};

const profileShape = {
  id: profile.id,
  name: profile.name,
  model: profile.model,
  createdAt: profile.createdAt,
};

export class ProfileQuery {
  private qb;

  constructor(private readonly db: SqliteDb) {
    this.qb = db.select(profileShape).from(profile).orderBy(profile.createdAt).$dynamic();
  }

  byId(id: string): this {
    this.qb = this.qb.where(eq(profile.id, id));
    return this;
  }

  execute(): Promise<Profile[]> {
    return Promise.resolve(this.qb.all());
  }

  executeAndTakeFirst(): Promise<Profile | null> {
    return Promise.resolve(this.qb.get() ?? null);
  }
}

export class ProfileRepository {
  constructor(private readonly db: SqliteDb) {}

  query(): ProfileQuery {
    return new ProfileQuery(this.db);
  }

  ensureDefault(): void {
    const existing = this.db.select().from(profile).where(eq(profile.id, DEFAULT_PROFILE_ID)).get();
    if (existing) return;
    this.db
      .insert(profile)
      .values({ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_ID, createdAt: Date.now() })
      .run();
  }

  insert(row: { id: string; name: string; createdAt: number }): void {
    this.db.insert(profile).values(row).run();
  }

  update(id: string, patch: ProfilePatch): void {
    const values: Partial<typeof profile.$inferInsert> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.model !== undefined) values.model = patch.model;
    if (!Object.keys(values).length) return;
    this.db.update(profile).set(values).where(eq(profile.id, id)).run();
  }

  delete(ids: OneOrMany<string>): void {
    const batch = asArray(ids);
    if (!batch.length) return;
    this.db.delete(profile).where(inArray(profile.id, batch)).run();
  }
}
