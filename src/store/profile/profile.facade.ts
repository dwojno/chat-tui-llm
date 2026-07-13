import type { OneOrMany } from "../helpers";
import type { StoreContext } from "../context";
import type { ConversationFacade } from "../conversation/conversation.facade";
import { slugifyProfileId } from "./helpers";
import {
  ProfileRepository,
  type Profile,
  type ProfilePatch,
  type ProfileQuery,
} from "./profile.repository";

export { DEFAULT_PROFILE_ID } from "./profile.repository";

export abstract class ProfileFacade {
  abstract query(): ProfileQuery;
  abstract create(name: string): Promise<Profile>;
  abstract update(id: string, patch: ProfilePatch): Promise<void>;
  abstract delete(id: OneOrMany<string>): Promise<void>;
  abstract switchTo(profileId: string): Promise<void>;
}

export class SqliteProfileFacade extends ProfileFacade {
  constructor(
    private readonly repo: ProfileRepository,
    private readonly ctx: StoreContext,
    private readonly conversations: ConversationFacade,
  ) {
    super();
  }

  query(): ProfileQuery {
    return this.repo.query();
  }

  async create(name: string): Promise<Profile> {
    const baseId = slugifyProfileId(name);
    let id = baseId;
    let suffix = 1;
    while ((await this.query().byId(id).executeAndTakeFirst()) !== null) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const createdAt = Date.now();
    const trimmed = name.trim();
    this.repo.insert({ id, name: trimmed, createdAt });
    return { id, name: trimmed, model: null, createdAt };
  }

  async update(id: string, patch: ProfilePatch): Promise<void> {
    this.repo.update(id, patch);
  }

  async delete(id: OneOrMany<string>): Promise<void> {
    this.repo.delete(id);
  }

  async switchTo(profileId: string): Promise<void> {
    if ((await this.query().byId(profileId).executeAndTakeFirst()) === null) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    const created = await this.conversations.create(profileId);
    this.ctx.bind(profileId, created.id); // persists the active-state pointer
  }
}
