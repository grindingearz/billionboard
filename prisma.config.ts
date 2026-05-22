// Load .env.local first (takes precedence), then fall back to .env
import { config } from "dotenv";
config({ path: ".env.local", override: false });
config({ path: ".env", override: false });
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
