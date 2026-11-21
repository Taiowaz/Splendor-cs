import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccountService } from './accountService.js';

export { AuthError } from './accountService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const SECRET_FILE = join(DATA_DIR, 'secret.key');

mkdirSync(DATA_DIR, { recursive: true });

const secret = existsSync(SECRET_FILE)
  ? readFileSync(SECRET_FILE, 'utf8').trim()
  : (() => {
      const key = randomBytes(32).toString('hex');
      writeFileSync(SECRET_FILE, key, { mode: 0o600 });
      return key;
    })();

let users = [];
try {
  users = JSON.parse(readFileSync(USERS_FILE, 'utf8')).users || [];
} catch {
  users = [];
}

function saveUsers() {
  const tmp = `${USERS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ users }, null, 2));
  renameSync(tmp, USERS_FILE);
}

const store = {
  getByName: name => users.find(user => user.name === name),
  getById: id => users.find(user => user.id === id),
  insert(user) {
    users.push(user);
    saveUsers();
  }
};

export const { register, login, verifyToken, guestToken, renameGuest, nameRegistered } =
  createAccountService({ store, secret });
