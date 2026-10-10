import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations.js';

export function openDatabase(path = 'data/sentinel.sqlite'): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  const database = new DatabaseSync(path);
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    database.exec('PRAGMA journal_mode = WAL');
    migrate(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
