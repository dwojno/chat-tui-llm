import type { Store } from "@chat/store";
import { openDatabase, type SqliteDb } from "@/backend/db/db";
import { ConversationFacade } from "./conversation";
import { ConversationRepository } from "./conversation/conversation.repository";
import { McpFacade } from "./mcp/mcp.facade";
import { McpRepository } from "./mcp/mcp.repository";
import { MemoryFacade } from "./memory/memory.facade";
import { MemoryRepository } from "./memory/memory.repository";
import { ProfileFacade } from "./profile/profile.facade";
import { ProfileRepository } from "./profile/profile.repository";
import { SourcesFacade, type RagDeps } from "./sources";
import { SourceRepository } from "./sources/source.repository";
import { DEFAULT_PROFILE_ID } from "./profile/helpers";
import { readActiveState } from "./active-state";
import { StoreContext } from "./context";

const IN_MEMORY = ":memory:";

export interface OpenStoreOptions {
  conversationId?: string | undefined;
  rag?: RagDeps | undefined;
}

interface StoreFacades {
  profile: ProfileFacade;
  conversation: ConversationFacade;
  memory: MemoryFacade;
  sources: SourcesFacade;
  mcp: McpFacade;
}

function createFacades(db: SqliteDb, ctx: StoreContext, rag?: RagDeps): StoreFacades {
  const profileRepo = new ProfileRepository(db);
  const conversationRepo = new ConversationRepository(db);
  const memoryRepo = new MemoryRepository(db);
  const sourceRepo = new SourceRepository(db);
  const mcpRepo = new McpRepository(db);

  profileRepo.ensureDefault();

  const conversation = new ConversationFacade(conversationRepo, ctx);
  const profile = new ProfileFacade(profileRepo, ctx, conversation);
  const memory = new MemoryFacade(memoryRepo);
  const sources = new SourcesFacade(sourceRepo, rag);
  const mcp = new McpFacade(mcpRepo);

  return { profile, conversation, memory, sources, mcp };
}

export class LocalStore implements Store {
  readonly profile: ProfileFacade;
  readonly conversation: ConversationFacade;
  readonly memory: MemoryFacade;
  readonly sources: SourcesFacade;
  readonly mcp: McpFacade;

  private constructor(
    private readonly ctx: StoreContext,
    facades: StoreFacades,
  ) {
    this.profile = facades.profile;
    this.conversation = facades.conversation;
    this.memory = facades.memory;
    this.sources = facades.sources;
    this.mcp = facades.mcp;
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
