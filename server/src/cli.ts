import fs from "node:fs";
import path from "node:path";
import { loadConfig, publicConfig } from "./config.js";
import { applyMigrations, migrate, openDatabase } from "./db.js";
import { resetLocalData } from "./resetLocalData.js";

async function main() {
  const command = process.argv[2] ?? "doctor";
  const config = loadConfig();

  if (command === "migrate") {
    migrate(config);
    console.log(`migrations applied to ${config.databasePath}`);
    return;
  }

  if (command === "doctor") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          config: publicConfig(config),
          databaseDirectoryExists: fs.existsSync(
            path.dirname(path.resolve(config.databasePath)),
          ),
          discordLogin: config.skipDiscordLogin ? "skipped" : "enabled",
          tokenLoaded: Boolean(config.discordToken),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "export-json") {
    const db = openDatabase(config.databasePath);
    try {
      console.log(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            boundaries: publicConfig(config),
            dailyStats: db
              .prepare("select * from daily_stats order by local_date desc")
              .all(),
            rankSnapshots: db
              .prepare("select * from rank_snapshots order by updated_at desc")
              .all(),
          },
          null,
          2,
        ),
      );
    } finally {
      db.close();
    }
    return;
  }

  if (command === "reset-local-data") {
    if (process.env.NODE_ENV === "production")
      throw new Error("reset-local-data is disabled in production");
    if (!process.argv.includes("--confirm")) {
      throw new Error(
        "Refusing to reset without --confirm. Run: pnpm reset:local-data --confirm",
      );
    }
    const db = openDatabase(config.databasePath);
    try {
      applyMigrations(db);
      const results = resetLocalData(db);
      console.log(`Local data reset complete: ${config.databasePath}`);
      for (const result of results)
        console.log(`- ${result.table}: ${result.rowsCleared} row(s) cleared`);
      console.log(
        "- preserved: users, tracked_channels, app_meta, schema, source, migrations, and .env",
      );
    } finally {
      db.close();
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
