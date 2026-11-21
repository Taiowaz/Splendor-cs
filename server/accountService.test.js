import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { syncBuiltinESMExports } from 'node:module';
import { AuthError, createAccountService } from './accountService.js';

const SECRET = 'test-only-secret';
const START = 1_700_000_000_000;
const TTL = 30 * 24 * 3600 * 1000;

function fixture() {
  const users = [];
  const store = {
    getByName: name => users.find(user => user.name === name),
    getById: id => users.find(user => user.id === id),
    insert: user => { users.push(user); }
  };
  let time = START;
  return {
    users,
    store,
    service: createAccountService({ store, secret: SECRET, now: () => time }),
    setTime(value) { time = value; }
  };
}

function payload(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}

function signRaw(raw, secret = SECRET) {
  const body = Buffer.from(raw).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function sign(value, secret = SECRET) {
  return signRaw(JSON.stringify(value), secret);
}

function authError(action, status = 400, message) {
  assert.throws(action, error => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.status, status);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  });
}

function observeCrypto(t, ...names) {
  const spies = Object.fromEntries(names.map(name => [name, t.mock.method(crypto, name)]));
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return spies;
}

function changeMac(token) {
  const [body, mac] = token.split('.');
  return `${body}.${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
}

test('factory requires an explicit non-empty secret and accepts string or Buffer keys', () => {
  const { store } = fixture();
  for (const secret of [undefined, null, '', Buffer.alloc(0), 123, {}]) {
    assert.throws(() => createAccountService({ store, secret }), TypeError);
  }
  const service = createAccountService({ store, secret: Buffer.from(SECRET), now: () => START });
  const token = sign({ uid: 'g_legacy', name: 'Guest', g: true, exp: START + TTL });
  assert.deepEqual(service.verifyToken(token), { id: 'g_legacy', name: 'Guest', guest: true });
});

test('factory exposes the synchronous API and AuthError preserves its status contract', () => {
  const { service } = fixture();
  assert.deepEqual(Object.keys(service).sort(), [
    'guestToken', 'login', 'nameRegistered', 'register', 'renameGuest', 'verifyToken'
  ]);
  const { guestToken, verifyToken, nameRegistered } = service;
  const guest = guestToken('Guest');
  assert.equal(typeof guest.token, 'string');
  assert.equal(verifyToken(guest.token).name, 'Guest');
  assert.equal(nameRegistered('Guest'), false);
  const error = new AuthError('invalid');
  assert.ok(error instanceof Error);
  assert.equal(error.message, 'invalid');
  assert.equal(error.status, 400);
  assert.equal(new AuthError('conflict', 409).status, 409);
});

test('registration stores the unchanged user schema and scrypt parameters', () => {
  const { service, users } = fixture();
  const result = service.register('  Alice  ', 'pAss word');
  assert.equal(users.length, 1);
  const stored = users[0];
  assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'hash', 'id', 'name', 'salt']);
  assert.match(stored.id, /^u_[0-9a-f]{12}$/);
  assert.match(stored.salt, /^[0-9a-f]{32}$/);
  assert.match(stored.hash, /^[0-9a-f]{128}$/);
  assert.equal(stored.hash, crypto.scryptSync('pAss word', stored.salt, 64).toString('hex'));
  assert.equal(stored.createdAt, START);
  assert.deepEqual(result.user, { id: stored.id, name: 'Alice', guest: false });
  assert.deepEqual(service.verifyToken(result.token), result.user);
  assert.deepEqual(payload(result.token), { uid: stored.id, exp: START + TTL });
  assert.equal(result.token, sign({ uid: stored.id, exp: START + TTL }));
});

test('login trims names but not passwords and refreshes token expiry', () => {
  const { service, users, setTime } = fixture();
  const registered = service.register('Alice', ' pass ');
  setTime(START + 1000);
  const loggedIn = service.login(' Alice ', ' pass ');
  assert.deepEqual(loggedIn.user, registered.user);
  assert.deepEqual(service.verifyToken(loggedIn.token), registered.user);
  assert.equal(payload(loggedIn.token).exp, START + 1000 + TTL);
  assert.equal(users.length, 1);
  authError(() => service.login('Alice', 'pass'), 401, '名字或密码不对');
});

test('wrong passwords and unknown accounts return the same authentication error', () => {
  const { service } = fixture();
  service.register('Alice', 'password');
  authError(() => service.login('Alice', 'incorrect'), 401, '名字或密码不对');
  authError(() => service.login('Missing', 'incorrect'), 401, '名字或密码不对');
});

test('names remain unique after trimming, case-sensitive, and exactly queried', () => {
  const { service, users } = fixture();
  service.register(' Alice ', 'password');
  authError(() => service.register('Alice', 'password'), 409, '这个名字已经注册过了，直接登录吧');
  assert.equal(users.length, 1);
  assert.equal(service.nameRegistered('Alice'), true);
  assert.equal(service.nameRegistered(' Alice '), false);
  assert.equal(service.nameRegistered('alice'), false);
  service.register('alice', 'password');
  assert.equal(service.nameRegistered('alice'), true);
  assert.equal(users.length, 2);
});

test('account and guest tokens expire exactly at the injected deadline', () => {
  const { service, setTime } = fixture();
  const account = service.register('Alice', 'password');
  const guest = service.guestToken('Guest');
  for (const time of [START, START + TTL - 1]) {
    setTime(time);
    assert.ok(service.verifyToken(account.token));
    assert.ok(service.verifyToken(guest.token));
  }
  for (const time of [START + TTL, START + TTL + 1]) {
    setTime(time);
    assert.equal(service.verifyToken(account.token), null);
    assert.equal(service.verifyToken(guest.token), null);
  }
});

test('the default clock is Date.now', t => {
  t.mock.method(Date, 'now', () => START);
  const { store } = fixture();
  const service = createAccountService({ store, secret: SECRET });
  assert.equal(payload(service.guestToken('Guest').token).exp, START + TTL);
});

test('verification reads current account identity and rejects removed accounts', () => {
  const { service, users } = fixture();
  const account = service.register('Alice', 'password');
  users[0].name = 'Renamed';
  assert.deepEqual(service.verifyToken(account.token), { ...account.user, name: 'Renamed' });
  users.splice(0, 1);
  assert.equal(service.verifyToken(account.token), null);
});

test('existing rows and HMAC tokens work across service instances with the same secret', () => {
  const { service, users, store } = fixture();
  const user = {
    id: 'u_0123456789ab', name: 'Legacy', salt: '0123456789abcdef0123456789abcdef',
    createdAt: START - 1000
  };
  user.hash = crypto.scryptSync('password', user.salt, 64).toString('hex');
  users.push(user);
  const token = sign({ uid: user.id, exp: START + TTL });
  assert.equal(service.login('Legacy', 'password').token, token);
  const recreated = createAccountService({ store, secret: SECRET, now: () => START });
  assert.deepEqual(recreated.verifyToken(token), { id: user.id, name: user.name, guest: false });
  const otherKey = createAccountService({ store, secret: 'other-test-secret', now: () => START });
  assert.equal(otherKey.verifyToken(token), null);
  assert.equal(fixture().service.verifyToken(token), null);
});

test('guest tokens preserve sanitization, truncation, fallback names, and stateless identity', () => {
  const { service, users } = fixture();
  const guest = service.guestToken('  A\0B\x7fC\x01DEFGHIJKLM  ');
  assert.equal(guest.name, 'ABCDEFGHI');
  const identity = service.verifyToken(guest.token);
  assert.match(identity.id, /^g_[0-9a-f]{12}$/);
  assert.deepEqual(identity, { id: identity.id, name: guest.name, guest: true });
  assert.deepEqual(payload(guest.token), { uid: identity.id, name: guest.name, g: true, exp: START + TTL });
  assert.equal(service.guestToken('x').name, 'x');
  assert.equal(service.guestToken('x'.repeat(64)).name, 'x'.repeat(12));
  assert.match(service.guestToken(' \0\x7f ').name, /^游客[0-9a-f]{4}$/);
  assert.match(service.guestToken('').name, /^游客[0-9a-f]{4}$/);
  assert.notEqual(service.verifyToken(service.guestToken(guest.name).token).id, identity.id);
  assert.equal(users.length, 0);
});

test('guest rename preserves uid, renews expiry, and leaves the old signed token valid', () => {
  const { service, setTime, users } = fixture();
  const guest = service.guestToken('Before');
  const identity = service.verifyToken(guest.token);
  setTime(START + 5000);
  const renamed = service.renameGuest(guest.token, '  A\0B\x7fC\x01DEFGHIJKLM  ');
  assert.equal(typeof renamed, 'string');
  assert.deepEqual(service.verifyToken(renamed), { ...identity, name: 'ABCDEFGHI' });
  assert.equal(payload(renamed).exp, START + 5000 + TTL);
  assert.deepEqual(service.verifyToken(guest.token), identity);
  setTime(START + TTL);
  assert.equal(service.verifyToken(guest.token), null);
  assert.ok(service.verifyToken(renamed));
  assert.equal(users.length, 0);
});

test('guest rename rejects account, expired, invalid, and empty-name requests', () => {
  const { service, setTime } = fixture();
  const account = service.register('Alice', 'password');
  const guest = service.guestToken('Guest');
  assert.equal(service.renameGuest(account.token, 'New'), null);
  assert.equal(service.renameGuest('invalid', 'New'), null);
  assert.equal(service.renameGuest(guest.token, ' \0\x7f '), null);
  setTime(START + TTL);
  assert.equal(service.renameGuest(guest.token, 'New'), null);
});

test('registration and login reject non-string and oversized inputs before store or crypto access', t => {
  const { service, store, users } = fixture();
  const getByName = t.mock.method(store, 'getByName');
  const { scryptSync } = observeCrypto(t, 'scryptSync');
  const hostile = { toString() { throw new Error('must not coerce'); } };
  const nonStrings = [undefined, null, 1234, true, [], ['Alice'], {}, hostile, Buffer.from('Alice')];
  for (const method of [service.register, service.login]) {
    for (const name of [...nonStrings, '', 'a', 'a'.repeat(13), ' '.repeat(63) + 'ab', 'A\0B', 'A\x7fB']) {
      authError(() => method(name, 'password'));
    }
    for (const pass of [...nonStrings, '', 'abc', 'p'.repeat(65)]) {
      authError(() => method('Alice', pass));
    }
  }
  assert.equal(getByName.mock.callCount(), 0);
  assert.equal(scryptSync.mock.callCount(), 0);
  assert.equal(users.length, 0);
});

test('name and password boundary lengths remain supported', () => {
  const { service } = fixture();
  const name = 'N'.repeat(12);
  const rawName = ' '.repeat(52) + name;
  const pass = 'p'.repeat(64);
  const result = service.register(rawName, pass);
  assert.equal(result.user.name, name);
  assert.deepEqual(service.login(rawName, pass).user, result.user);
  const minimum = service.register('AB', 'pass');
  assert.deepEqual(service.login('AB', 'pass').user, minimum.user);
});

test('guest names and name queries reject non-string or over-64 input without coercion', () => {
  const { service } = fixture();
  const guest = service.guestToken('Guest');
  const hostile = { toString() { throw new Error('must not coerce'); } };
  for (const value of [undefined, null, 12, false, [], {}, hostile, 'x'.repeat(65)]) {
    authError(() => service.guestToken(value));
    authError(() => service.renameGuest(guest.token, value));
    authError(() => service.nameRegistered(value));
  }
  assert.equal(service.nameRegistered('x'.repeat(64)), false);
  assert.equal(service.nameRegistered(''), false);
});

test('verification rejects malformed, tampered, or wrongly signed tokens without throwing', () => {
  const { service } = fixture();
  const guest = service.guestToken('Guest');
  const [body, mac] = guest.token.split('.');
  const hostile = { toString() { throw new Error('must not coerce'); } };
  for (const token of [
    undefined, null, 42, {}, [], hostile, Buffer.from(guest.token), '', 'token', '.mac', `${body}.`,
    `${body}.short`, `${body}.${mac}extra`, `${body}.${mac}.extra`, changeMac(guest.token),
    `${Buffer.from(JSON.stringify({ ...payload(guest.token), name: 'Changed' })).toString('base64url')}.${mac}`,
    sign(payload(guest.token), 'wrong-test-secret'), signRaw('{bad json'), sign(null), sign({}),
    sign({ uid: 1, exp: START + TTL }), sign({ uid: 'g_id', g: true }),
    sign({ uid: 'g_id', g: true, exp: START }), sign({ uid: 'u_absent', exp: START + TTL })
  ]) {
    assert.equal(service.verifyToken(token), null);
  }
});

test('verification retains legacy signed guest name and expiry comparison semantics', () => {
  const { service } = fixture();
  const token = sign({ uid: 'g_old', name: '', g: true, exp: String(START + TTL) });
  assert.deepEqual(service.verifyToken(token), { id: 'g_old', name: '游客', guest: true });
});

test('the 4096-character token limit is enforced before HMAC work', t => {
  const { service } = fixture();
  const raw = JSON.stringify({ uid: 'g_limit', name: 'Guest', g: true, exp: START + TTL });
  const atLimit = signRaw(raw.padEnd(3039));
  const overLimit = signRaw(raw.padEnd(3040));
  assert.equal(atLimit.length, 4096);
  assert.equal(overLimit.length, 4098);
  assert.equal(service.verifyToken(atLimit).id, 'g_limit');
  const { createHmac } = observeCrypto(t, 'createHmac');
  assert.equal(service.verifyToken(overLimit), null);
  assert.equal(service.verifyToken('x'.repeat(4097)), null);
  assert.equal(createHmac.mock.callCount(), 0);
});

test('login always uses scrypt and timingSafeEqual for known and unknown accounts', t => {
  const { service, users } = fixture();
  service.register('Alice', 'password');
  const { scryptSync, timingSafeEqual } = observeCrypto(t, 'scryptSync', 'timingSafeEqual');
  service.login('Alice', 'password');
  authError(() => service.login('Alice', 'incorrect'), 401);
  authError(() => service.login('Missing', 'incorrect'), 401);
  assert.deepEqual(scryptSync.mock.calls.map(call => call.arguments), [
    ['password', users[0].salt, 64],
    ['incorrect', users[0].salt, 64],
    ['incorrect', '0'.repeat(32), 64]
  ]);
  assert.equal(timingSafeEqual.mock.callCount(), 3);
  for (const call of timingSafeEqual.mock.calls) {
    assert.equal(call.arguments[0].length, 64);
    assert.equal(call.arguments[1].length, 64);
  }
  assert.deepEqual(timingSafeEqual.mock.calls[2].arguments[1], Buffer.alloc(64));
});

test('MAC comparison uses timingSafeEqual only after checking equal byte lengths', t => {
  const { service } = fixture();
  const guest = service.guestToken('Guest');
  const { timingSafeEqual } = observeCrypto(t, 'timingSafeEqual');
  assert.ok(service.verifyToken(guest.token));
  assert.equal(service.verifyToken(changeMac(guest.token)), null);
  assert.equal(service.verifyToken(`${guest.token}extra`), null);
  assert.equal(timingSafeEqual.mock.callCount(), 2);
  for (const call of timingSafeEqual.mock.calls) {
    assert.equal(call.arguments[0].length, 43);
    assert.equal(call.arguments[1].length, 43);
  }
});

test('public results, token payloads, and auth errors do not leak credentials or log secrets', t => {
  const logs = ['log', 'info', 'warn', 'error', 'debug'].map(name => t.mock.method(console, name, () => {}));
  const { service, users } = fixture();
  const password = 'private-test-password';
  const registered = service.register('Alice', password);
  const loggedIn = service.login('Alice', password);
  const identity = service.verifyToken(registered.token);
  assert.deepEqual(Object.keys(registered).sort(), ['token', 'user']);
  assert.deepEqual(Object.keys(loggedIn).sort(), ['token', 'user']);
  for (const user of [registered.user, loggedIn.user, identity]) {
    assert.deepEqual(Object.keys(user).sort(), ['guest', 'id', 'name']);
  }
  assert.deepEqual(Object.keys(payload(registered.token)).sort(), ['exp', 'uid']);
  const errors = [];
  for (const action of [
    () => service.login('Alice', 'wrong-password'),
    () => service.login('Missing', 'wrong-password'),
    () => service.register('Alice', password),
    () => service.register(SECRET.repeat(10), password),
    () => service.login('Alice', password.repeat(10))
  ]) {
    assert.throws(action, error => {
      assert.ok(error instanceof AuthError);
      errors.push({ message: error.message, status: error.status, stack: error.stack });
      return true;
    });
  }
  const visible = JSON.stringify([registered, loggedIn, identity, payload(registered.token), errors]);
  for (const sensitive of [password, SECRET, users[0].salt, users[0].hash]) {
    assert.equal(visible.includes(sensitive), false);
  }
  assert.equal(JSON.stringify(users).includes(password), false);
  for (const log of logs) assert.equal(log.mock.callCount(), 0);
});
