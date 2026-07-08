import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/store/sqlite/schema.ts",
  out: "./src/store/sqlite/migrations",
  dbCredentials: {
    url: ".chat-state/chat.db",
  },
});
