// Run with: node --test notes/tests/bread-backend.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../bread-backend.js'), 'utf8');
const BASE = 'https://kaidaz18.duckdns.org/api/v1/kaidaz18-notes';
const KEY = 'ledger.bread.session.v1';

function harness(options = {}) {
  const stored = options.stored || new Map();
  const requests = [];
  const listeners = {};
  const records = { projects: [], tasks: [], notes: [] };
  const state = { records, listeners: {}, configs: [], logoutCalls: 0, uploads: 0, deletedFiles: [], next: 1 };
  const localStorage = {
    getItem: key => stored.has(key) ? stored.get(key) : null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: key => stored.delete(key),
  };
  const window = {
    location: { href: 'https://kaidaz18yt.github.io/notes/' }, localStorage,
    fetch: async (input, init) => { requests.push({ input, init }); return {}; },
    addEventListener: (name, cb) => { (listeners[name] ||= []).push(cb); },
    dispatchEvent: event => { (listeners[event.type] || []).forEach(cb => cb(event)); },
  };
  class MockBreadClient {
    constructor(config) {
      state.configs.push(config);
      this.auth = {
        signup: async () => ({ id: 'alice' }),
        login: async () => options.sdkManaged ? undefined : { token: 'token-for-alice' },
        me: async () => ({ user: { id: 'alice', email: 'alice@example.com' } }),
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
        update: async (id, data) => { const index = records[name].findIndex(record => record.id === id); records[name][index] = { ...records[name][index], ...data }; return { id, ...data }; },
        delete: async id => { records[name] = records[name].filter(record => record.id !== id); },
        subscribe: callback => { state.listeners[name] = callback; return () => { delete state.listeners[name]; }; },
      };
    }
  }
  if (!options.lexicalSdk) window.BreadClient = MockBreadClient;
  class CustomEvent { constructor(type) { this.type = type; } }
  const context = vm.createContext({ window, URL, Headers, CustomEvent, console, Set, Date, ...(options.lexicalSdk ? { BreadClient: MockBreadClient } : {}) });
  vm.runInContext(source, context);
  return { backend: window.LedgerBackend, window, requests, stored, state, listeners };
}

test('uses the current SDK configuration, ownership fields, and documented list fallback', async () => {
  const { backend, state } = harness();
  await backend.login('alice@example.com', 'password');
  assert.equal(state.configs[0].baseUrl, 'https://kaidaz18.duckdns.org');
  assert.equal(state.configs[0].projectSlug, 'kaidaz18-notes');
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
});

test('scopes the restored bearer and API key to this exact project', async () => {
  const { backend, window, requests } = harness();
  await backend.login('alice@example.com', 'password');
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
  await first.backend.login('alice@example.com', 'password');
  assert.ok(first.backend.hasSession);
  assert.equal(first.stored.get(KEY), '__sdk_managed_session__');
  await first.window.fetch(BASE + '/auth/me', { headers: { Authorization: 'Bearer sdk-managed-token' } });
  assert.equal(first.requests[0].init.headers.get('authorization'), 'Bearer sdk-managed-token');
  const reloaded = harness({ sdkManaged: true, stored: first.stored });
  assert.equal((await reloaded.backend.restore()).ledgerId, 'alice');
});

test('accepts fullUrl-only uploads, enforces the size limit, and handles missing delete support', async () => {
  const { backend, state } = harness();
  await backend.login('alice@example.com', 'password');
  const uploaded = await backend.upload({ name: 'My document.txt', type: 'text/plain', size: 4 });
  assert.equal(uploaded.filename, 'example name.txt');
  assert.equal(backend.fileUrl(uploaded), BASE + '/files/example%20name.txt');
  assert.equal(uploaded.name, 'My document.txt');
  await backend.deleteFile(uploaded.filename);
  assert.deepEqual(state.deletedFiles, ['example name.txt']);
  await assert.rejects(backend.upload({ name: 'too-large', size: backend.MAX_FILE_SIZE + 1 }), /50 MB/);
  assert.equal(state.uploads, 1);
  const external = harness({ fileResult: { fullUrl: 'https://cdn.example/file/abc' } });
  await external.backend.login('alice@example.com', 'password');
  const file = await external.backend.upload({ name: 'external.txt', size: 1, type: '' });
  assert.equal(file.filename, null);
  assert.equal(external.backend.fileUrl(file), 'https://cdn.example/file/abc');
  await assert.rejects(external.backend.deleteFile(file.fullUrl), /does not expose deletion/);
});

test('rejects known partial collections rather than displaying an incomplete workspace', async () => {
  const { backend } = harness({ listResult: { items: [], hasMore: true } });
  await backend.login('alice@example.com', 'password');
  await assert.rejects(backend.list('notes'), /partial collection/);
});

test('stops forwarding subscription events after logout, even if server logout fails', async () => {
  const { backend, state, stored } = harness({ logoutFails: true });
  await backend.login('alice@example.com', 'password');
  let received = 0;
  const unsubscribe = await backend.subscribe('notes', () => received++);
  state.listeners.notes({ action: 'create' });
  assert.equal(received, 1);
  await assert.rejects(backend.logout(), /logout failed/);
  assert.equal(backend.hasSession, false);
  assert.equal(backend.user, null);
  assert.equal(stored.has(KEY), false);
  state.listeners.notes({ action: 'create' });
  assert.equal(received, 1);
  unsubscribe();
  assert.equal(state.listeners.notes, undefined);
});


test('accepts an SDK class exposed as a global lexical binding', async () => {
  const { backend } = harness({ lexicalSdk: true });
  await backend.login('alice@example.com', 'password');
  assert.equal(backend.user.ledgerId, 'alice');
});


test('does not silently hide documents without an owner field', async () => {
  const { backend, state } = harness();
  await backend.login('alice@example.com', 'password');
  state.records.notes.push({ id: 'legacy', title: 'Missing owner' });
  await assert.rejects(backend.list('notes'), /ownerId/);
});
