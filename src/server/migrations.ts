import type { DatabaseSync } from 'node:sqlite';

const migrations = [
  `
    CREATE TABLE services (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      url TEXT NOT NULL CHECK (length(trim(url)) > 0),
      interval_ms INTEGER NOT NULL DEFAULT 60000 CHECK (interval_ms > 0),
      timeout_ms INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms > 0),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    ) STRICT;

    CREATE TABLE check_results (
      id INTEGER PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      checked_at INTEGER NOT NULL CHECK (checked_at >= 0),
      healthy INTEGER NOT NULL CHECK (healthy IN (0, 1)),
      http_status INTEGER CHECK (http_status BETWEEN 100 AND 599),
      response_time_ms REAL CHECK (response_time_ms >= 0),
      error TEXT
    ) STRICT;

    CREATE INDEX check_results_service_time
      ON check_results(service_id, checked_at DESC, id DESC);
    CREATE INDEX check_results_time ON check_results(checked_at);
  `,
];

export function migrate(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    const { user_version: version } = database.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (version > migrations.length) {
      throw new Error(`Database version ${version} is newer than this application supports`);
    }

    for (let index = version; index < migrations.length; index++) {
      database.exec(migrations[index]);
      database.exec(`PRAGMA user_version = ${index + 1}`);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
