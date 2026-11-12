// 极简账号：用户名 + 密码存本地 JSON，会话用 HMAC 签名的 token（无状态，
// 服务端重启也不掉登录）。游客也发 token —— 刷新能回房靠的是「身份不变」，
// 账号只是把这份身份从「本浏览器」升级成「跨设备」。
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');
const SECRET_FILE = join(DATA_DIR, 'secret.key');

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天
const NAME_MIN = 2, NAME_MAX = 12;
const PASS_MIN = 4, PASS_MAX = 64;

mkdirSync(DATA_DIR, { recursive: true });

// 签名密钥落盘：重启后旧 token 依然验得过，否则一重启全员掉登录
const SECRET = existsSync(SECRET_FILE)
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

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cleanName(raw) {
  const name = String(raw ?? '').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new AuthError(`名字要 ${NAME_MIN}-${NAME_MAX} 个字符`);
  }
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) throw new AuthError('名字里不能有控制字符');
  }
  return name;
}

function cleanPass(raw) {
  const pass = String(raw ?? '');
  if (pass.length < PASS_MIN || pass.length > PASS_MAX) {
    throw new AuthError(`密码要 ${PASS_MIN}-${PASS_MAX} 个字符`);
  }
  return pass;
}

function hashPass(pass, salt) {
  return scryptSync(pass, salt, 64).toString('hex');
}

function publicUser(u) {
  return { id: u.id, name: u.name, guest: false };
}

export function register(rawName, rawPass) {
  const name = cleanName(rawName);
  const pass = cleanPass(rawPass);
  if (users.some(u => u.name === name)) {
    throw new AuthError('这个名字已经注册过了，直接登录吧', 409);
  }
  const salt = randomBytes(16).toString('hex');
  const user = {
    id: `u_${randomBytes(6).toString('hex')}`,
    name,
    salt,
    hash: hashPass(pass, salt),
    createdAt: Date.now()
  };
  users.push(user);
  saveUsers();
  return { token: issueToken(user), user: publicUser(user) };
}

export function login(rawName, rawPass) {
  const name = String(rawName ?? '').trim();
  const pass = String(rawPass ?? '');
  const user = users.find(u => u.name === name);
  // 名字不存在也走一遍 scrypt，避免用响应时间猜哪些名字注册过
  const salt = user ? user.salt : '0'.repeat(32);
  const want = user ? user.hash : '0'.repeat(128);
  const got = hashPass(pass, salt);
  const ok = timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'));
  if (!user || !ok) throw new AuthError('名字或密码不对', 401);
  return { token: issueToken(user), user: publicUser(user) };
}

function issueToken(user) {
  return sign({ uid: user.id, exp: Date.now() + TOKEN_TTL_MS });
}

// 游客身份：名字直接签进 token，不落 users.json（游客没有密码可验）
export function guestToken(rawName) {
  let name = String(rawName ?? '').trim().slice(0, NAME_MAX);
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) name = name.replace(ch, '');
  }
  if (name.length < 1) name = `游客${randomBytes(2).toString('hex')}`;
  return {
    token: sign({ uid: `g_${randomBytes(6).toString('hex')}`, name, g: true, exp: Date.now() + TOKEN_TTL_MS }),
    name
  };
}

// 游客改名：uid 不变（席位还认得他），只把名字重新签进 token
export function renameGuest(token, rawName) {
  const identity = verifyToken(token);
  if (!identity || !identity.guest) return null;
  let name = String(rawName ?? '').trim().slice(0, NAME_MAX);
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) name = name.replace(ch, '');
  }
  if (name.length < 1) return null;
  return sign({ uid: identity.id, name, g: true, exp: Date.now() + TOKEN_TTL_MS });
}

// 验签 + 过期 + 账号还在。返回 { id, name, guest }，失败返回 null。
export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const want = createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.uid !== 'string' || !(payload.exp > Date.now())) return null;
  if (payload.g) {
    return { id: payload.uid, name: String(payload.name || '游客'), guest: true };
  }
  const user = users.find(u => u.id === payload.uid);
  if (!user) return null;
  return { id: user.id, name: user.name, guest: false };
}