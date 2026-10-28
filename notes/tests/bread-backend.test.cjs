// Run with: node --test notes/tests/bread-backend.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../bread-backend.js'), 'utf8');
const BASE = 'https://kaidaz18.duckdns.org/api/v1/kaidaz18-notes';
const KEY = 'ledger.bread.session.v1';
const CHANGE_KEY = 'ledger.bread.change.v1';
const ACCOUNT_EMAIL = 'kaioliver111@gmail.com';

function harness(options = {}) {
  const stored = options.stored || new Map();
  const requests = [];
  const listeners = {};
  const records = { projects: [], tasks: [], notes: [] };
  const state = { records, listeners: {}, configs: [], loginCalls: [], updateCalls: [], sdkSubscribeCalls: 0, sdkScripts: [], sdkTimers: new Map(), meCalls: 0, logoutCalls: 0, uploads: 0, deletedFiles: [], next: 1 };
  const localStorage = {
    getItem: key => stored.has(key) ? stored.get(key) : null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: key => stored.delete(key),
  };
  const window = {
    location: { href: 'https://kaidaz18yt.github.io/notes/' }, localStorage,
    fetch: async (input, init) => { requests.push({ input, init }); return {}; },
    addEventListener: (name, cb) => { (listeners[name] ||= []).push(cb); },
    removeEventListener: (name, cb) => { listeners[name] = (listeners[name] || []).filter(item => item !== cb); },
    dispatchEvent: event => { (listeners[event.type] || []).slice().forEach(cb => cb(event)); },
  };
  class MockBreadClient {
    constructor(config) {
      state.configs.push(config);
      this.auth = {
        login: async (email, password) => { state.loginCalls.push({ email, password }); return options.sdkManaged ? undefined : { token: 'token-for-alice' }; },
        me: async () => { state.meCalls++; if (options.meError) throw options.meError; return { user: options.profile || { id: 'alice', email: ACCOUNT_EMAIL } }; },
        logout: async () => { state.logoutCalls++; if (options.logoutFails) throw new Error('logout failed'); },
      };
      this.files = {
        upload: async () => { state.uploads++; return options.fileResult || { fullUrl: BASE + '/files/example%20name.txt' }; },
        delete: async filename => state.deletedFiles.push(filename),
      };
    }
    collection(name) {
      return {
        get: async () => options.listResult || records[name],
        create: async data => { const record = { ...data, id: 'doc-' + state.next++ }; records[name].push(record); return record; },
        update: async (id, data) => { state.updateCalls.push({ name, id, data }); const index = records[name].findIndex(record => record.id === id); records[name][index] = { ...records[name][index], ...data }; return { id, ...data }; },
        delete: async id => { records[name] = records[name].filter(record => record.id !== id); },
        subscribe: callback => { state.sdkSubscribeCalls++; state.listeners[name] = callback; return () => { delete state.listeners[name]; }; },
      };
    }
  }
  state.installSdk = () => { window.BreadClient = MockBreadClient; };
  if (!options.lexicalSdk && !options.sdkMissing) state.installSdk();
  let timerId = 0;
  const head = {
    appendChild: script => { script.parentNode = head; state.sdkScripts.push(script); },
    removeChild: script => { script.parentNode = null; script.removed = true; },
  };
  window.document = { head, createElement: tag => { assert.equal(tag, 'script'); return {}; } };
  window.setTimeout = (fn, ms) => { const id = ++timerId; state.sdkTimers.set(id, { fn, ms }); return id; };
  window.clearTimeout = id => state.sdkTimers.delete(id);
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  const context = vm.createContext({ window, URL, Headers, CustomEvent, console, Set, Date, ...(options.lexicalSdk ? { BreadClient: MockBreadClient } : {}) });
  vm.runInContext(source, context);
  return { backend: window.LedgerBackend, window, requests, stored, state, listeners };
}

test('uses the current SDK configuration, ownership fields, and documented list fallback', async () => {
  const { backend, state } = harness();
  await backend.login('password');
  assert.equal(state.configs[0].baseUrl, 'https://kaidaz18.duckdns.org');
  assert.equal(state.configs[0].projectSlug, 'kaidaz18-notes');
  assert.deepEqual(state.loginCalls[0], { email: ACCOUNT_EMAIL, password: 'password' });
  assert.equal(typeof backend.signup, 'undefined');
  assert.equal(backend.user.ledgerId, 'alice');
  const note = await backend.create('notes', { title: 'Mine', ownerId: 'someone-else' });
  assert.equal(note.ownerId, 'alice');
  assert.ok(note.id && note.created && note.updated);
  state.records.notes.push({ id: 'other', ownerId: 'bob', title: 'Not mine' });
  assert.deepEqual(Array.from(await backend.list('notes'), item => item.id), [note.id]);
  assert.equal((await backend.get('notes', note.id)).title, 'Mine'); // no getById in the mock SDK
  await assert.rejects(backend.get('notes', 'other'));
  const updated = await backend.update('notes', note.id, { title: 'Changed', ownerId: 'bob' });
  assert.equal(updated.title, 'Changed');
  assert.equal(state.records.notes[0].ownerId, 'alice');
  assert.equal(state.updateCalls[0].data.ownerId, 'alice');
  assert.equal(updated.ownerId, 'alice');
});

test('scopes the restored bearer and API key to this exact project', async () => {
  const { backend, window, requests } = harness();
  await backend.login('password');
  await window.fetch(BASE + '/collections/notes', { headers: { 'Content-Type': 'application/json' } });
  await window.fetch(BASE + '-other/collections/notes', { headers: {} });
  await window.fetch('https://elsewhere.example/collect', { headers: {} });
  assert.equal(requests[0].init.headers.get('authorization'), 'Bearer token-for-alice');
  assert.equal(requests[0].init.headers.get('x-api-key'), backend.API_KEY);
  assert.equal(requests[1].init.headers.authorization, undefined);
  assert.equal(requests[2].init.headers.authorization, undefined);
});

test('supports an SDK-managed session without a login return value', async () => {
  const first = harness({ sdkManaged: true });
  await first.backend.login('password');
  assert.ok(first.backend.hasSession);
  assert.equal(first.stored.get(KEY), '__sdk_managed_session__');
  await first.window.fetch(BASE + '/auth/me', { headers: { Authorization: 'Bearer sdk-managed-token' } });
  assert.equal(first.requests[0].init.headers.get('authorization'), 'Bearer sdk-managed-token');
  const reloaded = harness({ sdkManaged: true, stored: first.stored });
  assert.equal((await reloaded.backend.restore()).ledgerId, 'alice');
});

test('accepts fullUrl-only uploads, enforces the size limit, and handles missing delete support', async () => {
  const { backend, state } = harness();
  await backend.login('password');
  const uploaded = await backend.upload({ name: 'My document.txt', type: 'text/plain', size: 4 });
  assert.equal(uploaded.filename, 'example name.txt');
  assert.equal(backend.fileUrl(uploaded), BASE + '/files/example%20name.txt');
  assert.equal(uploaded.name, 'My document.txt');
  await backend.deleteFile(uploaded.filename);
  assert.deepEqual(state.deletedFiles, ['example name.txt']);
  await assert.rejects(backend.upload({ name: 'too-large', size: backend.MAX_FILE_SIZE + 1 }), /50 MB/);
  assert.equal(state.uploads, 1);
  const external = harness({ fileResult: { fullUrl: 'https://cdn.example/file/abc' } });
  await external.backend.login('password');
  const file = await external.backend.upload({ name: 'external.txt', size: 1, type: '' });
  assert.equal(file.filename, null);
  assert.equal(external.backend.fileUrl(file), 'https://cdn.example/file/abc');
  await assert.rejects(external.backend.deleteFile(file.fullUrl), /does not expose deletion/);
});

test('rejects known partial collections rather than displaying an incomplete workspace', async () => {
  const { backend } = harness({ listResult: { items: [], hasMore: true } });
  await backend.login('password');
  await assert.rejects(backend.list('notes'), /partial collection/);
});

test('uses local cross-tab invalidations instead of the SDK realtime stream', async () => {
  const { backend, state, stored, listeners } = harness();
  await backend.login('password');
  const received = [];
  const unsubscribe = await backend.subscribe('notes', event => received.push(event.collection));
  assert.equal(state.sdkSubscribeCalls, 0);

  const note = await backend.create('notes', { title: 'Private test content' });
  const firstSignal = stored.get(CHANGE_KEY);
  assert.deepEqual(Object.keys(JSON.parse(firstSignal)).sort(), ['collection', 'nonce']);
  assert.equal(JSON.parse(firstSignal).collection, 'notes');
  assert.doesNotMatch(firstSignal, /Private test content|token-for-alice|password/);
  listeners.storage[0]({ key: CHANGE_KEY, newValue: firstSignal });
  assert.deepEqual(received, ['notes']);

  listeners.storage[0]({ key: CHANGE_KEY, newValue: JSON.stringify({ collection: 'tasks' }) });
  listeners.storage[0]({ key: CHANGE_KEY, newValue: '{malformed' });
  listeners.storage[0]({ key: CHANGE_KEY, newValue: JSON.stringify({ collection: 'not-a-collection' }) });
  assert.deepEqual(received, ['notes']);

  await backend.update('notes', note.id, { title: 'Updated' });
  const secondSignal = stored.get(CHANGE_KEY);
  assert.notEqual(secondSignal, firstSignal);
  await backend.delete('notes', note.id);
  assert.notEqual(stored.get(CHANGE_KEY), secondSignal);
  unsubscribe();
  listeners.storage[0]({ key: CHANGE_KEY, newValue: firstSignal });
  assert.deepEqual(received, ['notes']);
  assert.equal((listeners['ledger-data-change'] || []).length, 0);
});

test('stops forwarding cross-tab changes after logout even if server logout fails', async () => {
  const { backend, state, stored, listeners } = harness({ logoutFails: true });
  await backend.login('password');
  let received = 0;
  const unsubscribe = await backend.subscribe('notes', () => received++);
  const change = { key: CHANGE_KEY, newValue: JSON.stringify({ collection: 'notes', nonce: 'test' }) };
  listeners.storage[0](change);
  assert.equal(received, 1);
  await assert.rejects(backend.logout(), /logout failed/);
  assert.equal(backend.hasSession, false);
  assert.equal(backend.user, null);
  assert.equal(stored.has(KEY), false);
  listeners.storage[0](change);
  assert.equal(received, 1);
  assert.equal(state.sdkSubscribeCalls, 0);
  unsubscribe();
});

test('writes remain usable when cross-tab storage is unavailable', async () => {
  const { backend, window } = harness();
  await backend.login('password');
  window.localStorage.setItem = () => { throw new Error('storage unavailable'); };
  const note = await backend.create('notes', { title: 'Still saved' });
  assert.equal(note.title, 'Still saved');
});


test('accepts an SDK class exposed as a global lexical binding', async () => {
  const { backend } = harness({ lexicalSdk: true });
  await backend.login('password');
  assert.equal(backend.user.ledgerId, 'alice');
});


test('does not silently hide documents without an owner field', async () => {
  const { backend, state } = harness();
  await backend.login('password');
  state.records.notes.push({ id: 'legacy', title: 'Missing owner' });
  await assert.rejects(backend.list('notes'), /ownerId/);
});


test('the fixed email is used with only a password and the password is not stored', async () => {
  const { backend, state, stored } = harness();
  await backend.login('test-password');
  assert.deepEqual(state.loginCalls[0], { email: ACCOUNT_EMAIL, password: 'test-password' });
  assert.equal(Array.from(stored.values()).some(value => String(value).includes('test-password')), false);
});

test('rejects a fresh login if the backend reports a different account', async () => {
  const { backend, state, stored } = harness({ profile: { id: 'other', email: 'other@example.com' } });
  await assert.rejects(backend.login('test-password'), error => backend.isAccountError(error));
  assert.equal(backend.user, null);
  assert.equal(backend.hasSession, false);
  assert.equal(stored.has(KEY), false);
  assert.equal(state.logoutCalls, 1);
});

test('rejects and clears a saved session for a different account', async () => {
  const stored = new Map([[KEY, 'old-session-token']]);
  const { backend, state } = harness({ stored, profile: { id: 'other', email: 'other@example.com' } });
  await assert.rejects(backend.restore(), error => backend.isAccountError(error));
  assert.equal(backend.user, null);
  assert.equal(backend.hasSession, false);
  assert.equal(stored.has(KEY), false);
  assert.equal(state.logoutCalls, 1);
});

test('allows a fresh login without a profile email, but requires a password again after reload', async () => {
  const first = harness({ profile: { id: 'alice' } });
  assert.equal((await first.backend.login('password')).ledgerId, 'alice');
  const reloaded = harness({ stored: first.stored, profile: { id: 'alice' } });
  await assert.rejects(reloaded.backend.restore(), error => reloaded.backend.isAccountError(error));
  assert.equal(reloaded.backend.hasSession, false);
});

test('restores an intended account regardless of email casing', async () => {
  const stored = new Map([[KEY, 'valid-session-token']]);
  const { backend } = harness({ stored, profile: { id: 'alice', email: ACCOUNT_EMAIL.toUpperCase() } });
  assert.equal((await backend.restore()).ledgerId, 'alice');
});

test('preserves a saved session when profile verification fails due to a network error', async () => {
  const stored = new Map([[KEY, 'valid-session-token']]);
  const { backend, state } = harness({ stored, meError: new Error('network unavailable') });
  await assert.rejects(backend.restore(), /network unavailable/);
  assert.equal(backend.hasSession, true);
  assert.equal(state.logoutCalls, 0);
});


test('retries a failed SDK load without reloading the page or sending credentials first', async () => {
  const { backend, state, stored } = harness({ sdkMissing: true });
  const first = backend.login('password');
  assert.equal(state.sdkScripts.length, 1);
  assert.equal(state.sdkScripts[0].src, 'https://kaidaz18.duckdns.org/sdk/bread-client.js');
  state.sdkScripts[0].onerror();
  await assert.rejects(first, error => backend.isSdkError(error));
  assert.equal(state.loginCalls.length, 0);
  assert.equal(state.sdkScripts[0].removed, true);
  assert.equal(state.sdkTimers.size, 0);
  assert.equal(stored.has(KEY), false);

  const second = backend.login('password');
  assert.equal(state.sdkScripts.length, 2);
  state.installSdk();
  state.sdkScripts[1].onload();
  assert.equal((await second).ledgerId, 'alice');
  assert.deepEqual(state.loginCalls[0], { email: ACCOUNT_EMAIL, password: 'password' });
});

test('reports an SDK script that loads but does not define BreadClient', async () => {
  const { backend, state } = harness({ sdkMissing: true });
  const attempt = backend.login('password');
  state.sdkScripts[0].onload();
  await assert.rejects(attempt, error => backend.isSdkError(error) && /could not start/.test(error.message));
  assert.equal(state.sdkTimers.size, 0);
  assert.equal(state.loginCalls.length, 0);
});

test('times out a stalled SDK load and permits a later retry', async () => {
  const { backend, state } = harness({ sdkMissing: true });
  const first = backend.login('password');
  const timeout = Array.from(state.sdkTimers.values())[0];
  assert.equal(timeout.ms, 12000);
  timeout.fn();
  await assert.rejects(first, error => backend.isSdkError(error) && /timed out/.test(error.message));
  assert.equal(state.sdkScripts[0].removed, true);
  const retry = backend.login('password');
  state.installSdk();
  state.sdkScripts[1].onload();
  assert.equal((await retry).ledgerId, 'alice');
});

test('shares concurrent SDK loads and preserves a saved session when loading fails', async () => {
  const stored = new Map([[KEY, 'valid-session-token']]);
  const { backend, state } = harness({ sdkMissing: true, stored });
  const first = backend.restore();
  const second = backend.restore();
  assert.equal(state.sdkScripts.length, 1);
  state.sdkScripts[0].onerror();
  await assert.rejects(first, error => backend.isSdkError(error));
  await assert.rejects(second, error => backend.isSdkError(error));
  assert.equal(backend.hasSession, true);
  assert.equal(stored.get(KEY), 'valid-session-token');

  const retry = backend.restore();
  state.installSdk();
  state.sdkScripts[1].onload();
  assert.equal((await retry).ledgerId, 'alice');
});

test('does not restore a session that changed while the SDK was loading', async () => {
  const stored = new Map([[KEY, 'valid-session-token']]);
  const { backend, state, listeners } = harness({ sdkMissing: true, stored });
  const pending = backend.restore();
  stored.delete(KEY);
  listeners.storage[0]({ key: KEY });
  state.installSdk();
  state.sdkScripts[0].onload();
  await assert.rejects(pending, /session changed/i);
  assert.equal(state.meCalls, 0);
  assert.equal(backend.hasSession, false);
});

test('preserves an existing session if a fresh sign-in cannot load the SDK', async () => {
  const stored = new Map([[KEY, 'valid-session-token']]);
  const { backend, state } = harness({ sdkMissing: true, stored });
  const attempt = backend.login('password');
  state.sdkScripts[0].onerror();
  await assert.rejects(attempt, error => backend.isSdkError(error));
  assert.equal(backend.hasSession, true);
  assert.equal(stored.get(KEY), 'valid-session-token');
  assert.equal(state.loginCalls.length, 0);
});

test('shares a successful SDK load across concurrent restores', async () => {
  const stored = new Map([[KEY, 'valid-session-token']]);
  const { backend, state } = harness({ sdkMissing: true, stored });
  const first = backend.restore();
  const second = backend.restore();
  assert.equal(state.sdkScripts.length, 1);
  state.installSdk();
  state.sdkScripts[0].onload();
  const users = await Promise.all([first, second]);
  assert.deepEqual(users.map(user => user.ledgerId), ['alice', 'alice']);
  assert.equal(state.sdkTimers.size, 0);
});
