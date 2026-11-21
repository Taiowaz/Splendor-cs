import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const TOKEN_MAX = 4096;
const INPUT_MAX = 64;
const NAME_MIN = 2, NAME_MAX = 12;
const PASS_MIN = 4, PASS_MAX = 64;

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function nameInput(raw) {
  if (typeof raw !== 'string' || raw.length > INPUT_MAX) {
    throw new AuthError(`名字必须是字符串，且不超过 ${INPUT_MAX} 个字符`);
  }
  return raw;
}

function cleanName(raw) {
  const name = nameInput(raw).trim();
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
  if (typeof raw !== 'string' || raw.length < PASS_MIN || raw.length > PASS_MAX) {
    throw new AuthError(`密码要 ${PASS_MIN}-${PASS_MAX} 个字符`);
  }
  return raw;
}

function cleanGuestName(raw) {
  let name = nameInput(raw).trim().slice(0, NAME_MAX);
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code < 32 || code === 127) name = name.replace(ch, '');
  }
  return name;
}

function hashPass(pass, salt) {
  return scryptSync(pass, salt, 64).toString('hex');
}

function publicUser(user) {
  return { id: user.id, name: user.name, guest: false };
}

export function createAccountService({ store, secret, now = Date.now }) {
  if ((typeof secret !== 'string' && !Buffer.isBuffer(secret)) || secret.length === 0) {
    throw new TypeError('secret must be a non-empty string or Buffer');
  }

  function sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  function issueToken(user) {
    return sign({ uid: user.id, exp: now() + TOKEN_TTL_MS });
  }

  function register(rawName, rawPass) {
    const name = cleanName(rawName);
    const pass = cleanPass(rawPass);
    if (store.getByName(name)) {
      throw new AuthError('这个名字已经注册过了，直接登录吧', 409);
    }
    const salt = randomBytes(16).toString('hex');
    const user = {
      id: `u_${randomBytes(6).toString('hex')}`,
      name,
      salt,
      hash: hashPass(pass, salt),
      createdAt: now()
    };
    store.insert(user);
    return { token: issueToken(user), user: publicUser(user) };
  }

  function login(rawName, rawPass) {
    const name = cleanName(rawName);
    const pass = cleanPass(rawPass);
    const user = store.getByName(name);
    // Unknown names still run scrypt and a constant-time hash comparison.
    const salt = user ? user.salt : '0'.repeat(32);
    const want = user ? user.hash : '0'.repeat(128);
    const got = hashPass(pass, salt);
    const ok = timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'));
    if (!user || !ok) throw new AuthError('名字或密码不对', 401);
    return { token: issueToken(user), user: publicUser(user) };
  }

  function nameRegistered(name) {
    return Boolean(store.getByName(nameInput(name)));
  }

  function guestToken(rawName) {
    const name = cleanGuestName(rawName) || `游客${randomBytes(2).toString('hex')}`;
    return {
      token: sign({ uid: `g_${randomBytes(6).toString('hex')}`, name, g: true, exp: now() + TOKEN_TTL_MS }),
      name
    };
  }

  function renameGuest(token, rawName) {
    const identity = verifyToken(token);
    if (!identity || !identity.guest) return null;
    const name = cleanGuestName(rawName);
    if (name.length < 1) return null;
    return sign({ uid: identity.id, name, g: true, exp: now() + TOKEN_TTL_MS });
  }

  function verifyToken(token) {
    if (typeof token !== 'string' || token.length > TOKEN_MAX) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const want = createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!payload || typeof payload.uid !== 'string' || !(payload.exp > now())) return null;
    if (payload.g) {
      return { id: payload.uid, name: String(payload.name || '游客'), guest: true };
    }
    const user = store.getById(payload.uid);
    if (!user) return null;
    return publicUser(user);
  }

  return { register, login, verifyToken, guestToken, renameGuest, nameRegistered };
}
