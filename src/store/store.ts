import { randomUUID } from "node:crypto";
import { openDatabase, type SqliteDb } from "@/store/db/db";
import { ConversationFacade, SqliteConversationFacade } from "./conversation";
import { ConversationRepository } from "./conversation/conversation.repository";
import { MemoryFacade, SqliteMemoryFacade } from "./memory";
import { MemoryRepository } from "./memory/memory.repository";
import { ProfileFacade, SqliteProfileFacade } from "./profile";
import { ProfileRepository } from "./profile/profile.repository";
import { SourcesFacade, SqliteSourcesFacade, type RagDeps } from "./sources";
import { SourceRepository } from "./sources/source.repository";
import { DEFAULT_PROFILE_ID } from "./profile/helpers";
import { readActiveState } from "./active-state";
import { StoreContext } from "./context";

const IN_MEMORY = ":memory:";

export interface OpenStoreOptions {
  conversationId?: string | undefined;
  rag?: RagDeps | undefined;
}

export interface Store {
  readonly profileId: string;
  readonly conversationId: string;
  readonly profile: ProfileFacade;
  readonly conversation: ConversationFacade;
  readonly memory: MemoryFacade;
  readonly sources: SourcesFacade;
}

interface StoreFacades {
  profile: ProfileFacade;
  conversation: ConversationFacade;
  memory: MemoryFacade;
  sources: SourcesFacade;
}

function createFacades(db: SqliteDb, ctx: StoreContext, rag?: RagDeps): StoreFacades {
  const profileRepo = new ProfileRepository(db);
  const conversationRepo = new ConversationRepository(db);
  const memoryRepo = new MemoryRepository(db);
  const sourceRepo = new SourceRepository(db);

  profileRepo.ensureDefault();

  const conversation = new SqliteConversationFacade(conversationRepo, ctx);
  const profile = new SqliteProfileFacade(profileRepo, ctx, conversation);
  const memory = new SqliteMemoryFacade(memoryRepo);
  const sources = new SqliteSourcesFacade(sourceRepo, rag);

  return { profile, conversation, memory, sources };
}

export class LocalStore implements Store {
  readonly profile: ProfileFacade;
  readonly conversation: ConversationFacade;
  readonly memory: MemoryFacade;
  readonly sources: SourcesFacade;

  private constructor(
    private readonly ctx: StoreContext,
    facades: StoreFacades,
  ) {
    this.profile = facades.profile;
    this.conversation = facades.conversation;
    this.memory = facades.memory;
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
      return new LocalStore(ctx, facades);
    }

    // Restore the last active profile, but always start a fresh conversation on
    // open (resume a specific one via `--conversation <id>`). bind() persists the
    // pointer with the new conversation id.
    const pointer = inMemory ? { profileId: DEFAULT_PROFILE_ID } : readActiveState(dbPath);
    const profileRow = await facades.profile.query().byId(pointer.profileId).executeAndTakeFirst();
    const profileId = profileRow ? pointer.profileId : DEFAULT_PROFILE_ID;

    const created = await facades.conversation.create(profileId);
    ctx.bind(profileId, created.id);

    return new LocalStore(ctx, facades);
  }
}

export function uniqueProfileName(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
