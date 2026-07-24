import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/store/db/schema.ts",
  out: "./src/store/db/migrations",
  dbCredentials: {
    url: "../../.chat-state/chat.db",
  },
});
