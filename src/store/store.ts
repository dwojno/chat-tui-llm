import { randomUUID } from "node:crypto";
import { openDatabase, type SqliteDb } from "../db/db";
import { ConversationFacade, SqliteConversationFacade } from "./conversation";
import { ConversationRepository } from "./conversation/conversation.repository";
import { FactFacade, SqliteFactFacade } from "./fact";
import { FactRepository } from "./fact/fact.repository";
import { ProfileFacade, SqliteProfileFacade } from "./profile";
import { ProfileRepository } from "./profile/profile.repository";
import { SourcesFacade, SqliteSourcesFacade, type RagDeps } from "./sources";
import { SourceRepository } from "./sources/source.repository";
import { DEFAULT_PROFILE_ID, readActivePointer, writeActivePointer } from "./profile/helpers";
import { StoreContext } from "./context";

const IN_MEMORY = ":memory:";

export interface OpenStoreOptions {
  conversationId?: string | undefined;
  /** When present, enables the sources RAG pipeline (S3/Qdrant/embeddings). */
  rag?: RagDeps | undefined;
}

export interface Store {
  readonly profileId: string;
  readonly conversationId: string;
  readonly profile: ProfileFacade;
  readonly conversation: ConversationFacade;
  readonly fact: FactFacade;
  readonly sources: SourcesFacade;
}

interface StoreFacades {
  profile: ProfileFacade;
  conversation: ConversationFacade;
  fact: FactFacade;
  sources: SourcesFacade;
}

function createFacades(db: SqliteDb, ctx: StoreContext, rag?: RagDeps): StoreFacades {
  const profileRepo = new ProfileRepository(db);
  const conversationRepo = new ConversationRepository(db);
  const factRepo = new FactRepository(db);
  const sourceRepo = new SourceRepository(db);

  profileRepo.ensureDefault();

  const conversation = new SqliteConversationFacade(conversationRepo, ctx);
  const profile = new SqliteProfileFacade(profileRepo, ctx, conversation);
  const fact = new SqliteFactFacade(factRepo);
  const sources = new SqliteSourcesFacade(sourceRepo, rag);

  return { profile, conversation, fact, sources };
}

export class LocalStore implements Store {
  readonly profile: ProfileFacade;
  readonly conversation: ConversationFacade;
  readonly fact: FactFacade;
  readonly sources: SourcesFacade;

  private constructor(
    private readonly ctx: StoreContext,
    facades: StoreFacades,
  ) {
    this.profile = facades.profile;
    this.conversation = facades.conversation;
    this.fact = facades.fact;
    this.sources = facades.sources;
  }

  get profileId(): string {
    return this.ctx.profileId;
  }

  get conversationId(): string {
    return this.ctx.conversationId;
  }

  static async open(dbPath: string, opts: OpenStoreOptions = {}): Promise<LocalStore> {
    const db = openDatabase(dbPath);
    const inMemory = dbPath === IN_MEMORY;
    const ctx = new StoreContext(DEFAULT_PROFILE_ID, "", dbPath, inMemory);
    const facades = createFacades(db, ctx, opts.rag);

    if (opts.conversationId) {
      const restored = await facades.conversation
        .query()
        .byId(opts.conversationId)
        .executeAndTakeFirst();
      if (!restored) throw new Error(`Conversation not found: ${opts.conversationId}`);
      ctx.bind(restored.profileId, restored.id);
      if (!inMemory) writeActivePointer(dbPath, { profileId: restored.profileId });
      return new LocalStore(ctx, facades);
    }

    const pointer = inMemory ? { profileId: DEFAULT_PROFILE_ID } : readActivePointer(dbPath);
    const profileRow = await facades.profile.query().byId(pointer.profileId).executeAndTakeFirst();
    const profileId = profileRow ? pointer.profileId : DEFAULT_PROFILE_ID;

    const created = await facades.conversation.create(profileId);
    ctx.bind(profileId, created.id);
    if (!inMemory) writeActivePointer(dbPath, { profileId });

    return new LocalStore(ctx, facades);
  }
}

export function uniqueProfileName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
