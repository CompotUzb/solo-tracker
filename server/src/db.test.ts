import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyMigrations,
  loadTrackedBoundary,
  migrate,
  openDatabase,
  readTrackedChannelIds,
  seedDatabase,
} from './db.js';

const tempFiles: string[] = [];

function tempDbPath(name: string): string {
  // Use a unique-enough suffix without Date.now()/Math.random() (unavailable in this harness elsewhere,
  // but kept deterministic here via the test name + index).
  const file = path.join(os.tmpdir(), `solo-system-${name}-${tempFiles.length}.sqlite`);
  tempFiles.push(file);
  return file;
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  }
});

describe('tracked-channel whitelist loading', () => {
  it('reads only enabled channels seeded into the database', () => {
    const db = openDatabase(':memory:');
    try {
      applyMigrations(db);
      const config = { trackedGuildId: 'guild-1', trackedChannelIds: ['chan-a', 'chan-b'], timezone: 'Asia/Tashkent' };
      seedDatabase(db, config, '002_rpg_schema.sql');

      expect(readTrackedChannelIds(db)).toEqual(['chan-a', 'chan-b']);

      db.prepare('update tracked_channels set enabled=0 where channel_id=?').run('chan-a');
      expect(readTrackedChannelIds(db)).toEqual(['chan-b']);
    } finally {
      db.close();
    }
  });

  it('loadTrackedBoundary reads the whitelist from the database after migrate/seed', () => {
    const databasePath = tempDbPath('boundary');
    const config = {
      databasePath,
      trackedGuildId: 'guild-7',
      trackedChannelIds: ['chan-1', 'chan-2'],
      timezone: 'Asia/Tashkent',
    };

    migrate(config);
    const boundary = loadTrackedBoundary(config);

    expect(boundary).toEqual({ trackedGuildId: 'guild-7', trackedChannelIds: ['chan-1', 'chan-2'] });
  });
});
