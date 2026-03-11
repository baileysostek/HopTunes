#!/usr/bin/env node
/**
 * Dev utility: deletes the library.db so the app starts fresh on next launch.
 * Usage: node scripts/clean-db.js
 *    or: npm run clean-db
 */
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'open-tunes', 'library.db');

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('Deleted:', dbPath);
} else {
  console.log('No database found at:', dbPath);
}
