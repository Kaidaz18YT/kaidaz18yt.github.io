/* End-to-end tests against a mock implementing the documented BreadClient API.
   See notes/README.md for the optional browser test dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '../..');
const API = 'https://kaidaz18.duckdns.org/api/v1/kaidaz18-notes';
const SDK = 'https://kaidaz18.duckdns.org/sdk/bread-client.js';
const API_KEY = 'pk_live_BpZSqs73ax25L4X91Ok0D3fY';
const ACCOUNT_EMAIL = 'kaioliver111@gmail.com';
const sdkSource = `
window.__breadSubscribers = {};
window.__emitBread = (name, event = {}) => (window.__breadSubscribers[name] || []).slice().forEach(cb => cb(event));
window.BreadClient = class BreadClient {
  constructor({baseUrl, projectSlug, apiKey}) {
    if (baseUrl !== 'https://kaidaz18.duckdns.org' || projectSlug !== 'kaidaz18-notes') throw new Error('Wrong SDK configuration');
    this.baseUrl = baseUrl + '/api/v1/' + projectSlug; this.apiKey = apiKey;
    this.token = localStorage.getItem('__mock_bread_token__');
    this.auth = {
      signup: (email,password) => this.request('/auth/signup', 'POST', {email,password}),
      login: async (email,password) => {
        const session = await this.request('/auth/login', 'POST', {email,password});
        this.token = session.token; localStorage.setItem('__mock_bread_token__', this.token);
        // The updated guide does not promise that login returns a token.
      },
      me: async () => ({user: await this.request('/auth/me', 'GET')}),
      logout: async () => { await this.request('/auth/logout', 'POST', {}); this.token = null; localStorage.removeItem('__mock_bread_token__'); }
    };
    this.files = {
      upload: (file) => { const form = new FormData(); form.append('file', file); return this.request('/files', 'POST', form); },
      list: () => this.request('/files', 'GET'),
      delete: (filename) => this.request('/files/' + encodeURIComponent(filename), 'DELETE')
    };
  }
  collection(name) {
    const root = '/collections/' + encodeURIComponent(name);
    return {
      get: () => this.request(root, 'GET'),
      create: (data) => this.request(root, 'POST', data),
      update: (id,data) => this.request(root + '/' + encodeURIComponent(id), 'PATCH', data),
      delete: (id) => this.request(root + '/' + encodeURIComponent(id), 'DELETE'),
      subscribe: (callback) => {
        const listeners = window.__breadSubscribers[name] ||= []; listeners.push(callback);
        return () => { const index = listeners.indexOf(callback); if (index >= 0) listeners.splice(index, 1); };
      }
    };
  }
  async request(url, method, data) {
    const headers = {'x-api-key': this.apiKey};
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let body;
    if (data instanceof FormData) body = data;
    else if (data !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(data); }
    const response = await fetch(this.baseUrl + url, {method, headers, body});
    const value = await response.json();
    if (!response.ok) { const e = new Error(value.error || 'Request failed'); e.status = response.status; throw e; }
    return value;
  }
};`;

function staticServer() {
  return http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filename = path.join(ROOT, pathname);
    if (!filename.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    if (filename.endsWith(path.sep)) filename += 'index.html';
    fs.readFile(filename, (error, body) => {
      if (error) { res.writeHead(404).end('Not found'); return; }
      const mime = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'application/javascript' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': mime }).end(body);
    });
  });
}
function mockBackend() {
  return { users: [
    { id: 'user-owner', email: ACCOUNT_EMAIL, password: 'password123' },
    { id: 'user-other', email: 'other@example.com', password: 'password456' },
  ], tokens: {}, docs: { projects: [], tasks: [], notes: [] }, files: {}, sequence: 0,
    uploads: 0, fail: {}, requests: [], loginAttempts: [] };
}
function attachRoutes(context, state) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, x-api-key',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
  context.route('https://fonts.googleapis.com/**', route => route.abort());
  context.route('https://fonts.gstatic.com/**', route => route.abort());
  context.route(SDK, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: sdkSource, headers: cors }));
  context.route(API + '/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.slice(new URL(API).pathname.length);
    const method = request.method();
    const headers = request.headers();
    state.requests.push({ endpoint, method, headers });
    const reply = (status, value) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(value) });
    if (method === 'OPTIONS') return reply(200, {});
    if (headers['x-api-key'] !== API_KEY) return reply(403, { error: 'Missing project key' });
    const body = () => JSON.parse(request.postData() || '{}');
    if (endpoint === '/auth/signup' && method === 'POST') {
      const input = body();
      if (state.users.some(user => user.email === input.email)) return reply(400, { error: 'Account already exists' });
      const user = { id: 'user-' + ++state.sequence, email: input.email, password: input.password };
      state.users.push(user);
      return reply(200, { id: user.id, email: user.email });
    }
    if (endpoint === '/auth/login' && method === 'POST') {
      const input = body(); state.loginAttempts.push(input);
      const user = state.users.find(u => u.email === input.email && u.password === input.password);
      if (!user) return reply(401, { error: 'Invalid credentials' });
      const token = 'token-' + ++state.sequence; state.tokens[token] = user.id;
      return reply(200, { token, user: { id: user.id, email: user.email } });
    }
    const userId = state.tokens[(headers.authorization || '').replace(/^Bearer /, '')];
    if (!userId) return reply(401, { error: 'Unauthorized' });
    if (endpoint === '/auth/logout' && method === 'POST') {
      delete state.tokens[(headers.authorization || '').replace(/^Bearer /, '')];
      return reply(200, { success: true });
    }
    if (endpoint === '/auth/me') {
      const user = state.users.find(u => u.id === userId);
      return reply(200, state.omitProfileEmail ? { id: user.id } : { id: user.id, email: user.email });
    }
    if (endpoint === '/files' && method === 'POST') {
      if (state.fail.upload) { state.fail.upload--; return reply(500, { error: 'Upload failed' }); }
      const filename = 'uploaded-' + ++state.sequence + '.txt';
      state.files[filename] = { ownerId: userId }; state.uploads++;
      return reply(200, { fullUrl: API + '/files/' + encodeURIComponent(filename) });
    }
    if (endpoint.startsWith('/files/') && method === 'DELETE') {
      const filename = decodeURIComponent(endpoint.slice('/files/'.length));
      delete state.files[filename];
      return reply(200, { success: true });
    }
    const match = endpoint.match(/^\/collections\/(projects|tasks|notes)(?:\/(.+))?$/);
    if (!match) return reply(404, { error: 'Not found' });
    const name = match[1], id = match[2] && decodeURIComponent(match[2]);
    const docs = state.docs[name];
    const failure = method + ':' + name;
    if (state.fail[failure]) { state.fail[failure]--; return reply(500, { error: 'Simulated failure' }); }
    if (method === 'GET' && !id) return reply(200, docs); // deliberately return all users to exercise the UI filter
    if (method === 'POST' && !id) {
      const input = body();
      // Simulate the ownership requirement in the recommended create rule.
      if (input.ownerId !== userId) return reply(403, { error: 'Invalid owner' });
      const record = { ...input, id: 'doc-' + ++state.sequence }; docs.push(record);
      return reply(200, record);
    }
    const index = docs.findIndex(doc => doc.id === id);
    if (index < 0) return reply(404, { error: 'Document not found' });
    if (method === 'GET') return reply(200, docs[index]);
    if (method === 'PATCH') {
      const patch = body();
      // The recommended update rule requires the current owner in the patch.
      if (docs[index].ownerId !== userId || patch.ownerId !== userId) return reply(403, { error: 'Invalid owner' });
      docs[index] = { ...docs[index], ...patch };
      // Exercise SDKs which return only the updated fields.
      return reply(200, { id, ...patch });
    }
    if (method === 'DELETE') { docs.splice(index, 1); return reply(200, { success: true }); }
    return reply(405, { error: 'Method not allowed' });
  });
}

async function main() {
  const server = staticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const executablePath = process.env.CHROMIUM_PATH || await (require('@sparticuz/chromium').default || require('@sparticuz/chromium')).executablePath();
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true })
    .catch(error => { server.close(); throw error; });
  const context = await browser.newContext();
  const state = mockBackend();
  attachRoutes(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const root = `http://127.0.0.1:${port}`;
  try {
    await page.goto(root + '/notes/', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#auth-form input:visible').count(), 1);
    assert.equal(await page.locator('#auth-form input:visible').getAttribute('type'), 'password');
    assert.equal(await page.locator('#login-email, #login-toggle, #login-confirm').count(), 0);
    await page.locator('#login-password').fill('incorrect-password');
    await page.locator('#login-btn').click();
    await page.getByText('Could not sign in. Check your password and account status.').waitFor();
    assert.equal(await page.locator('#app.visible').count(), 0);
    await page.locator('#login-password').fill('password123');
    await page.locator('#login-btn').click();
    await page.locator('#app.visible').waitFor();
    await page.getByText('No tasks here yet.').waitFor();
    const aliceId = state.users[0].id;
    assert.ok(state.loginAttempts.every(attempt => attempt.email === ACCOUNT_EMAIL));
    assert.equal(state.loginAttempts[1].password, 'password123');
    assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => String(value).includes('password123'))), false);
    assert.equal(state.requests.some(r => r.endpoint === '/auth/signup'), false);
    assert.equal(state.requests.some(r => r.endpoint === '/auth/me' && r.headers.authorization?.startsWith('Bearer ')), true);

    await page.locator('#menu-btn').click();
    await page.locator('#new-project-name').fill('Studio');
    await page.locator('#new-project-btn').click();
    await page.locator('#project-list').getByText('Studio', { exact: true }).waitFor();
    const project = state.docs.projects[0];
    assert.equal(project.ownerId, aliceId);
    await page.locator('#rail-close').click();
    await page.locator('#add-btn').click();
    await page.locator('#task-title').fill('Publish video');
    await page.locator('#task-project').selectOption(project.id);
    await page.locator('#task-save-btn').click();
    await page.getByText('Publish video', { exact: true }).waitFor();
    assert.equal(state.docs.tasks[0].project, project.id);
    assert.deepEqual(state.docs.tasks[0].linked_notes, []);

    await page.locator('#menu-btn').click();
    await page.locator('#switch-notes').click();
    await page.locator('#rail-close').click();
    await page.locator('#add-btn').click();
    await page.locator('#note-title').fill('Launch notes');
    await page.locator('#note-project').selectOption(project.id);
    await page.locator('#note-content').fill('Hello BreadBackend');
    await page.locator('#file-input').setInputFiles({ name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first') });
    await page.locator('#note-save-btn').click();
    await page.locator('#note-modal-overlay').waitFor({ state: 'hidden' });
    await page.getByText('Launch notes', { exact: true }).waitFor();
    let note = state.docs.notes[0];
    assert.equal(note.ownerId, aliceId);
    assert.equal(note.project, project.id);
    assert.match(note.content, /Hello BreadBackend/);
    assert.equal(note.attachments[0].name, 'first.txt');
    assert.ok(note.created && note.updated);
    const firstFile = note.attachments[0].filename;
    assert.ok(state.files[firstFile]);

    // A failed document update must leave the draft open, the old attachment intact,
    // and retry the already uploaded new file rather than uploading it again.
    await page.getByText('Launch notes', { exact: true }).click();
    await page.locator('.attach-item[data-existing] .remove-attach').click();
    await page.locator('#file-input').setInputFiles({ name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('second') });
    await page.locator('#note-title').fill('Launch notes revised');
    state.fail['PATCH:notes'] = 1;
    await page.locator('#note-save-btn').click();
    await page.getByText('Could not save note. Your draft is still open; please retry.').waitFor();
    assert.equal(await page.locator('#note-modal-overlay').evaluate(el => el.classList.contains('open')), true);
    assert.ok(state.files[firstFile]);
    assert.equal(state.uploads, 2);
    await page.locator('#note-save-btn').click();
    await page.locator('#note-modal-overlay').waitFor({ state: 'hidden' });
    await page.getByText('Launch notes revised', { exact: true }).waitFor();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Note saved'));
    note = state.docs.notes[0];
    assert.equal(state.uploads, 2);
    assert.equal(note.attachments[0].name, 'second.txt');
    assert.ok(state.files[firstFile], 'previously attached files must not be deleted without reference-safe storage');
    const secondFile = note.attachments[0].filename;

    // Task-note links are plain JSON, not PocketBase relations.
    await page.locator('#menu-btn').click(); await page.locator('#switch-tasks').click(); await page.locator('#rail-close').click();
    await page.getByText('Publish video', { exact: true }).click();
    await page.locator('#task-link-existing').click();
    await page.locator('#note-picker-list').getByText('Launch notes revised', { exact: true }).click();
    await page.locator('#task-save-btn').click();
    await page.locator('#task-modal-overlay').waitFor({ state: 'hidden' });
    assert.deepEqual(state.docs.tasks[0].linked_notes, [note.id]);

    // Session restoration works with a fresh SDK instance and no stored password.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#app.visible').waitFor();
    await page.getByText('Publish video', { exact: true }).waitFor();
    assert.equal(await page.locator('#login-password').inputValue(), '');

    // The dashboard shares the session and refreshes from BreadBackend.
    const board = await context.newPage();
    board.on('pageerror', error => errors.push(error.message));
    await board.goto(root + '/notes/dashboard/', { waitUntil: 'domcontentloaded' });
    await board.locator('#board.visible').waitFor();
    await board.getByText('Publish video', { exact: true }).waitFor();
    state.docs.tasks[0].title = 'Updated on another screen';
    await board.waitForFunction(() => (window.__breadSubscribers.tasks || []).length > 0);
    await board.evaluate(() => window.__emitBread('tasks', { action: 'update' }));
    await board.getByText('Updated on another screen', { exact: true }).waitFor();

    // Change from another screen and verify that saving asks before overwriting.
    await page.locator('#menu-btn').click(); await page.locator('#switch-notes').click(); await page.locator('#rail-close').click();
    await page.getByText('Launch notes revised', { exact: true }).click();
    await page.locator('#note-title').fill('My version');
    state.docs.notes[0].title = 'Someone else changed this';
    state.docs.notes[0].updated = '2030-01-01T00:00:00.000Z';
    page.removeAllListeners('dialog');
    let sawConflict = false;
    page.once('dialog', async dialog => { sawConflict = /changed on another screen/i.test(dialog.message()); await dialog.dismiss(); });
    await page.locator('#note-save-btn').click();
    await page.waitForTimeout(100);
    assert.equal(sawConflict, true);
    assert.equal(state.docs.notes[0].title, 'Someone else changed this');
    assert.equal(await page.locator('#note-title').inputValue(), 'My version');
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#note-save-btn').click();
    await page.locator('#note-modal-overlay').waitFor({ state: 'hidden' });
    assert.equal(state.docs.notes[0].title, 'My version');

    // Deleting a note clears task links but retains stored files safely.
    await page.getByText('My version', { exact: true }).click();
    await page.locator('#note-delete-btn').click();
    await page.locator('#note-modal-overlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Note deleted'));
    assert.equal(state.docs.notes.length, 0);
    assert.deepEqual(state.docs.tasks[0].linked_notes, []);
    assert.ok(state.files[secondFile], 'deleting a note must retain files without reference-safe deletion');

    // Project deletion must not remove a project after a partial unassignment.
    state.fail['PATCH:tasks'] = 1;
    await page.evaluate(id => deleteProject(id), project.id);
    assert.equal(state.docs.projects.length, 1);
    assert.equal(state.docs.tasks[0].project, project.id);
    await page.evaluate(id => deleteProject(id), project.id);
    assert.equal(state.docs.projects.length, 0);
    assert.equal(state.docs.tasks[0].project, null);
    assert.equal(state.docs.tasks.length, 1);

    // A failed load should show a retry notice rather than a misleading empty board.
    state.fail['GET:tasks'] = 1;
    await board.evaluate(() => syncData());
    await board.locator('#sync-notice:not([hidden])').waitFor();
    await board.locator('#sync-retry').click();
    await board.locator('#sync-notice').waitFor({ state: 'hidden' });

    // Signing out in one tab clears the other; the dashboard also accepts
    // only a password and shares the restored owner session.
    await board.locator('#signout').click();
    await page.locator('#login-screen:not(.hidden)').waitFor();
    assert.equal(await board.evaluate(() => (window.__breadSubscribers.tasks || []).length), 0);
    assert.ok(state.requests.some(r => r.endpoint === '/auth/logout'));
    assert.equal(await page.locator('#tasks-view').innerText(), '');
    assert.equal(await board.locator('#auth-form input:visible').count(), 1);
    assert.equal(await board.locator('#auth-form input:visible').getAttribute('type'), 'password');
    await board.locator('#login-password').fill('incorrect-password');
    await board.locator('#login-btn').click();
    await board.getByText('Could not sign in. Check your password and account status.').waitFor();
    assert.equal(await board.locator('#board.visible').count(), 0);
    await board.locator('#login-password').fill('password123');
    await board.locator('#login-btn').click();
    await board.locator('#board.visible').waitFor();
    await page.locator('#app.visible').waitFor();
    await page.locator('#menu-btn').click(); await page.locator('#switch-tasks').click(); await page.locator('#rail-close').click();
    await page.getByText('Updated on another screen', { exact: true }).waitFor();
    assert.ok(state.loginAttempts.every(attempt => attempt.email === ACCOUNT_EMAIL));

    // The mock deliberately returns other owners' documents; the UI must not
    // display them. Real confidentiality still depends on backend rules.
    state.docs.tasks.push({ id: 'other-task', ownerId: 'user-other', title: 'Other person task', priority: 'Medium', status: 'To Do' });
    await page.evaluate(() => syncData());
    assert.equal(await page.getByText('Other person task', { exact: true }).count(), 0);

    // A saved session from the former multi-account UI must not be reused.
    const foreignContext = await browser.newContext();
    attachRoutes(foreignContext, state);
    const foreignPage = await foreignContext.newPage();
    foreignPage.on('pageerror', error => errors.push(error.message));
    await foreignPage.goto(root + '/notes/', { waitUntil: 'domcontentloaded' });
    state.tokens['other-account-token'] = 'user-other';
    await foreignPage.evaluate(() => {
      localStorage.setItem('__mock_bread_token__', 'other-account-token');
      localStorage.setItem('ledger.bread.session.v1', '__sdk_managed_session__');
    });
    await foreignPage.reload({ waitUntil: 'domcontentloaded' });
    await foreignPage.getByText('This saved session is for a different account. Please sign in again.').waitFor();
    assert.equal(await foreignPage.locator('#app.visible').count(), 0);
    assert.equal(await foreignPage.evaluate(() => localStorage.getItem('ledger.bread.session.v1')), null);

    // The dashboard independently rejects the same kind of foreign session.
    await foreignPage.goto(root + '/notes/dashboard/', { waitUntil: 'domcontentloaded' });
    state.tokens['other-board-token'] = 'user-other';
    await foreignPage.evaluate(() => {
      localStorage.setItem('__mock_bread_token__', 'other-board-token');
      localStorage.setItem('ledger.bread.session.v1', '__sdk_managed_session__');
    });
    await foreignPage.reload({ waitUntil: 'domcontentloaded' });
    await foreignPage.getByText('This saved session is for a different account. Please sign in again.').waitFor();
    assert.equal(await foreignPage.locator('#board.visible').count(), 0);

    // Profiles without an email can log in, but cannot restore an unverified session.
    await foreignPage.goto(root + '/notes/', { waitUntil: 'domcontentloaded' });
    state.omitProfileEmail = true;
    state.tokens['no-email-token'] = 'user-owner';
    await foreignPage.evaluate(() => {
      localStorage.setItem('__mock_bread_token__', 'no-email-token');
      localStorage.setItem('ledger.bread.session.v1', '__sdk_managed_session__');
    });
    await foreignPage.reload({ waitUntil: 'domcontentloaded' });
    await foreignPage.getByText('Could not verify the saved account. Please sign in again.').waitFor();
    await foreignPage.locator('#login-password').fill('password123');
    await foreignPage.locator('#login-btn').click();
    await foreignPage.locator('#app.visible').waitFor();
    state.omitProfileEmail = false;
    await foreignContext.close();

    // Stored HTML, IDs and colours are untrusted even if a server rule is misconfigured.
    state.docs.projects.push({ id: 'project-unsafe\" onmouseover=\"window.__xss=1', ownerId: aliceId,
      name: 'Owner project', color: '#111111\" onmouseover=\"window.__xss=1' });
    state.docs.notes.push({ id: 'note-unsafe\" onmouseover=\"window.__xss=1', ownerId: aliceId,
      title: 'Untrusted note', content: '<p>Safe text</p><img src=x onerror=\"window.__xss=1\"><svg onload=\"window.__xss=1\"></svg>',
      pinned: false, attachments: [], updated: new Date().toISOString() });
    await page.evaluate(() => syncData());
    await page.locator('#menu-btn').click();
    assert.equal(await page.locator('#project-list [onmouseover]').count(), 0);
    await page.locator('#switch-notes').click(); await page.locator('#rail-close').click();
    await page.getByText('Untrusted note', { exact: true }).click();
    assert.equal(await page.locator('#note-content svg, #note-content [onerror], #note-content script').count(), 0);
    assert.match(await page.locator('#note-content').innerText(), /Safe text/);
    assert.equal(await page.evaluate(() => window.__xss || 0), 0);
    await page.locator('[data-close="note"]').first().click();

    const diagnostic = await context.newPage();
    diagnostic.on('pageerror', error => errors.push(error.message));
    await diagnostic.goto(root + '/notes/test/', { waitUntil: 'domcontentloaded' });
    await diagnostic.getByText(/All 5 checks passed/).waitFor();
    assert.deepEqual(errors, []);
    console.log('Browser integration: password-only sign-in, CRUD, uploads, sessions, dashboard, conflicts, account isolation and diagnostics passed.');
  } catch (error) {
    console.error('Browser test diagnostics:', JSON.stringify({
      records: state.docs, errors, recentRequests: state.requests.slice(-8).map(({endpoint, method}) => ({endpoint, method})),
      notesView: await page.locator('#notes-view').innerText().catch(() => ''),
      toast: await page.locator('#toast').innerText().catch(() => ''),
    }));
    throw error;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
