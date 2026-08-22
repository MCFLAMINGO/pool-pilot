'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Writable data dir. On Vercel the deployment FS is read-only except /tmp.
 */
function dataDir() {
  if (process.env.POOL_PILOT_DATA_DIR) return process.env.POOL_PILOT_DATA_DIR;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', 'pool-pilot-data');
  }
  return path.join(__dirname, '..', 'data');
}

function ensureDataDir() {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { dataDir, ensureDataDir };
