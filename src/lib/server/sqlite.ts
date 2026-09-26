import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

declare global {
  // eslint-disable-next-line no-var
  var __diDauDb: DatabaseSync | undefined;
}

function createDatabase() {
  const databasePath =
    process.env.SQLITE_PATH ??
    path.join(process.cwd(), ".data", "di-dau.sqlite");

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_places (
      owner_key TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      description TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      distance_km REAL NOT NULL DEFAULT 0,
      price_label TEXT NOT NULL,
      average_for_two TEXT NOT NULL,
      public_rating REAL NOT NULL DEFAULT 0,
      match_score INTEGER NOT NULL DEFAULT 80,
      community_note TEXT NOT NULL,
      open_until TEXT NOT NULL,
      best_time TEXT NOT NULL,
      noise TEXT NOT NULL,
      crowd TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      scenarios_json TEXT NOT NULL,
      note TEXT NOT NULL,
      accent TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'PERSONAL',
      provider_id TEXT,
      address TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, id)
    );

    CREATE TABLE IF NOT EXISTS saved_places (
      owner_key TEXT NOT NULL,
      place_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, place_id)
    );

    CREATE TABLE IF NOT EXISTS personal_ratings (
      owner_key TEXT NOT NULL,
      place_id TEXT NOT NULL,
      stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
      revisit TEXT NOT NULL CHECK (revisit IN ('yes', 'maybe', 'no')),
      contexts_json TEXT NOT NULL,
      note TEXT NOT NULL,
      visited_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, place_id)
    );

    CREATE TABLE IF NOT EXISTS visits (
      owner_key TEXT NOT NULL,
      id TEXT NOT NULL,
      place_id TEXT NOT NULL,
      visited_at TEXT NOT NULL,
      rating_stars INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, id)
    );

    CREATE INDEX IF NOT EXISTS visits_owner_date_idx
      ON visits (owner_key, visited_at DESC);

    CREATE TABLE IF NOT EXISTS collections (
      owner_key TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, id)
    );

    CREATE TABLE IF NOT EXISTS collection_places (
      owner_key TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      place_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, collection_id, place_id),
      FOREIGN KEY (owner_key, collection_id)
        REFERENCES collections (owner_key, id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS collection_places_owner_place_idx
      ON collection_places (owner_key, place_id);
  `);

  return db;
}

export function getDatabase() {
  globalThis.__diDauDb ??= createDatabase();
  return globalThis.__diDauDb;
}
