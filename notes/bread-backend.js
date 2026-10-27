/* Shared BreadBackend integration for Ledger and its dashboard.
   The project key is a public client key, not an administrator credential. */
(function (window) {
  'use strict';

  const SERVER_URL = 'https://kaidaz18.duckdns.org';
  const PROJECT_SLUG = 'kaidaz18-notes';
  const BASE_URL = SERVER_URL + '/api/v1/' + PROJECT_SLUG;
  const API_KEY = 'pk_live_BpZSqs73ax25L4X91Ok0D3fY';
  const SESSION_KEY = 'ledger.bread.session.v1';
  const SDK_SESSION = '__sdk_managed_session__';
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const COLLECTIONS = new Set(['projects', 'tasks', 'notes']);
  const apiUrl = new URL(BASE_URL);
  const nativeFetch = window.fetch.bind(window);
  let session = readSession();
  let token = session === SDK_SESSION ? null : session;
  let user = null;
  let client = null;
  let revision = 0;
  let authVersion = 0;

  function readSession() {
    try { return window.localStorage.getItem(SESSION_KEY) || null; }
    catch (_) { return null; }
  }
  function saveSession(value) {
    session = value || null;
    token = session === SDK_SESSION ? null : session;
    try {
      if (session) window.localStorage.setItem(SESSION_KEY, session);
      else window.localStorage.removeItem(SESSION_KEY);
    } catch (_) {
      // Login still works for this tab if browser storage is unavailable.
    }
  }
  function syncClientToken() {
    // Some SDK versions keep a public token property. The scoped fetch wrapper
    // below is also needed because the guide does not document a token setter.
    if (client && token) {
      try { client.token = token; } catch (_) {}
    }
  }

  // BreadClient documents login but not how to restore its token in a new
  // instance. Attach our saved session to SDK fetches for this project only.
  // Never attach it to a different origin or to another project on this host.
  window.fetch = function (input, init) {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, window.location.href); }
    catch (_) { return nativeFetch(input, init); }
    if (url.origin !== apiUrl.origin ||
        (url.pathname !== apiUrl.pathname && !url.pathname.startsWith(apiUrl.pathname + '/'))) {
      return nativeFetch(input, init);
    }
    const options = Object.assign({}, init);
    const headers = new Headers(options.headers || (input && input.headers) || undefined);
    headers.set('x-api-key', API_KEY);
    // If the SDK manages its own session, preserve the header it supplied.
    if (token) headers.set('Authorization', 'Bearer ' + token);
    options.headers = headers;
    return nativeFetch(input, options);
  };

  function sdk() {
    // A classic script may expose a global lexical class rather than a window property.
    const BreadSDK = typeof window.BreadClient === 'function' ? window.BreadClient
      : typeof BreadClient === 'function' ? BreadClient : null;
    if (!BreadSDK) throw new Error('The BreadBackend SDK could not be loaded. Check your connection and try again.');
    if (!client) client = new BreadSDK({ baseUrl: SERVER_URL, projectSlug: PROJECT_SLUG, apiKey: API_KEY });
    syncClientToken();
    return client;
  }
  function normaliseUser(value) {
    const result = value && (value.user || (value.data && (value.data.user || value.data)) || value);
    if (!result || typeof result !== 'object') throw new Error('BreadBackend did not return a user profile.');
    // Email is a fallback for SDK versions whose user profile does not expose an id.
    const id = result.id ?? result.userId ?? result._id ?? result.email;
    if (id === undefined || id === null || id === '') throw new Error('The user profile has no account identifier.');
    return Object.assign({}, result, { ledgerId: String(id) });
  }
  function currentUserId() {
    if (!user) throw new Error('Please sign in before accessing your data.');
    return user.ledgerId;
  }
  function sessionSnapshot() { return { version: authVersion, id: currentUserId() }; }
  function assertSession(snapshot) {
    if (!session || authVersion !== snapshot.version || !user || user.ledgerId !== snapshot.id) {
      throw new Error('The session changed. Please sign in and try again.');
    }
  }
  function recordFrom(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const record = value.document || value.record || (value.data && !Array.isArray(value.data) && value.data.id ? value.data : value);
    if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
    // Some backends wrap document fields in a data object alongside metadata.
    const fields = record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data : {};
    return Object.assign({}, fields, record);
  }
  function normaliseRecord(value, fallbackId) {
    const record = recordFrom(value);
    const id = record.id ?? fallbackId;
    if (id === undefined || id === null || id === '') throw new Error('BreadBackend did not return a document ID.');
    const normalised = Object.assign({}, record, { id: String(id) });
    const created = record.created || record.createdAt || record.created_at;
    const updated = record.updated || record.updatedAt || record.updated_at || created;
    if (created) normalised.created = created;
    if (updated) normalised.updated = updated;
    return normalised;
  }
  function collection(name) {
    if (!COLLECTIONS.has(name)) throw new Error('Unknown Ledger collection.');
    currentUserId();
    return sdk().collection(name);
  }
  function asArray(result) {
    // Do not silently operate on a known-incomplete list. Pagination semantics
    // are not specified in the integration guide.
    if (result && (result.hasMore === true || result.nextCursor || result.nextPage ||
        (Number.isFinite(result.totalPages) && Number.isFinite(result.page) && result.page < result.totalPages))) {
      throw new Error('BreadBackend returned a partial collection; pagination support is needed.');
    }
    const items = Array.isArray(result) ? result
      : result && Array.isArray(result.items) ? result.items
      : result && Array.isArray(result.documents) ? result.documents
      : result && Array.isArray(result.data) ? result.data : null;
    if (!items) throw new Error('BreadBackend returned an unexpected collection response.');
    const total = result && (result.totalItems ?? result.totalCount ?? result.total);
    if (!Array.isArray(result) && Number.isFinite(total) && total > items.length) {
      throw new Error('BreadBackend returned a partial collection; pagination support is needed.');
    }
    return items;
  }
  function statusOf(error) {
    return Number(error && (error.status || error.statusCode || (error.response && error.response.status))) || 0;
  }
  function isUnauthorized(error) {
    return statusOf(error) === 401 || /(?:unauthori[sz]ed|invalid.{0,20}token|token.{0,20}expired)/i.test(String(error && error.message || ''));
  }
  function missingCollection(error) {
    const message = String(error && (error.message || (error.response && error.response.message)) || '');
    return statusOf(error) === 404 && /collection.{0,40}(not found|does not exist|missing)|(not found|missing).{0,40}collection/i.test(message);
  }
  function filenameOf(attachment) {
    return typeof attachment === 'string' ? attachment : attachment && (attachment.filename || attachment.fullUrl);
  }
  function safeFileUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, BASE_URL + '/');
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }
  function filenameFromUrl(value) {
    const url = safeFileUrl(value);
    if (!url) return null;
    const parsed = new URL(url);
    const prefix = apiUrl.pathname + '/files/';
    if (parsed.origin !== apiUrl.origin || !parsed.pathname.startsWith(prefix)) return null;
    try { return decodeURIComponent(parsed.pathname.slice(prefix.length)) || null; }
    catch (_) { return null; }
  }

  const backend = {
    BASE_URL,
    API_KEY,
    SESSION_KEY,
    MAX_FILE_SIZE,
    get user() { return user; },
    get hasSession() { return !!session; },
    get revision() { return revision; },
    statusOf,
    isUnauthorized,
    filenameOf,
    fileUrl(attachment) {
      const fullUrl = attachment && typeof attachment === 'object' ? safeFileUrl(attachment.fullUrl) : safeFileUrl(/^https:\/\//i.test(String(attachment)) ? attachment : null);
      if (fullUrl) return fullUrl;
      const filename = filenameOf(attachment);
      return filename ? BASE_URL + '/files/' + encodeURIComponent(filename) : '';
    },

    async signup(email, password) {
      return sdk().auth.signup(email, password);
    },
    async login(email, password) {
      // Make sure a failed restore or previous account cannot supply a stale token.
      const version = ++authVersion;
      saveSession(null);
      user = null;
      client = null;
      const result = await sdk().auth.login(email, password);
      if (version !== authVersion) throw new Error('The session changed. Please try again.');
      const newToken = result && (result.token || result.accessToken || result.access_token);
      // The current guide does not promise a return value from login. In that
      // case let the SDK manage its session, and attempt to restore it later.
      saveSession(typeof newToken === 'string' && newToken ? newToken : SDK_SESSION);
      syncClientToken();
      return this.restore();
    },
    async restore() {
      if (!session) return null;
      const version = authVersion;
      const sessionAtStart = session;
      const profile = await sdk().auth.me();
      if (version !== authVersion || session !== sessionAtStart) throw new Error('The session changed. Please try again.');
      user = normaliseUser(profile);
      return user;
    },
    async logout() {
      const version = ++authVersion;
      let error = null;
      try {
        const instance = sdk();
        if (instance.auth && typeof instance.auth.logout === 'function') await instance.auth.logout();
      } catch (err) { error = err; }
      finally {
        // Do not clear a different session that started while logout was in flight.
        if (version === authVersion) {
          saveSession(null);
          user = null;
          client = null;
          revision++;
        }
      }
      if (error) throw error;
    },

    async list(name) {
      const snapshot = sessionSnapshot();
      let result;
      try { result = await collection(name).get({}); }
      catch (error) {
        assertSession(snapshot);
        if (missingCollection(error)) return [];
        throw error;
      }
      assertSession(snapshot);
      const id = snapshot.id;
      // This is a UI filter, NOT an access-control rule. Configure the server
      // to enforce ownership as well; the client key is intentionally public.
      const records = asArray(result).map(item => normaliseRecord(item));
      if (records.some(item => item.ownerId === undefined || item.ownerId === null || item.ownerId === '')) {
        throw new Error('Ledger documents must include ownerId. Check the backend collection schema and migration.');
      }
      return records.filter(item => String(item.ownerId) === id);
    },
    async get(name, id) {
      const snapshot = sessionSnapshot();
      const source = collection(name);
      let value;
      if (typeof source.getById === 'function') value = await source.getById(id);
      else {
        // The latest guide only documents get(); use its list when getById
        // is unavailable rather than assuming an undocumented SDK method.
        const records = await this.list(name);
        value = records.find(item => item.id === String(id));
        if (!value) throw new Error('This document could not be found.');
      }
      const result = normaliseRecord(value, id);
      assertSession(snapshot);
      if (String(result.ownerId ?? '') !== snapshot.id) throw new Error('This document is not available for this account.');
      return result;
    },
    async create(name, data) {
      const snapshot = sessionSnapshot();
      const now = new Date().toISOString();
      const payload = Object.assign({}, data, { ownerId: currentUserId(), created: now, updated: now });
      const result = recordFrom(await collection(name).create(payload));
      assertSession(snapshot);
      const record = normaliseRecord(Object.assign({}, payload, result));
      revision++;
      return record;
    },
    async update(name, id, data) {
      const snapshot = sessionSnapshot();
      const payload = Object.assign({}, data, { updated: new Date().toISOString() });
      // Ownership and creation time cannot be changed through this helper.
      delete payload.ownerId;
      delete payload.created;
      const result = recordFrom(await collection(name).update(id, payload));
      assertSession(snapshot);
      const record = normaliseRecord(Object.assign({}, payload, result), id);
      revision++;
      return record;
    },
    async delete(name, id) {
      const snapshot = sessionSnapshot();
      await collection(name).delete(id);
      assertSession(snapshot);
      revision++;
    },
    async upload(file) {
      const snapshot = sessionSnapshot();
      if (file.size > MAX_FILE_SIZE) throw new Error('Files must be 50 MB or smaller.');
      const result = await sdk().files.upload(file);
      assertSession(snapshot);
      const fullUrl = safeFileUrl(result && result.fullUrl);
      const filename = result && typeof result.filename === 'string' && result.filename
        ? result.filename : filenameFromUrl(fullUrl);
      if (!filename && !fullUrl) throw new Error('BreadBackend did not return an uploaded file URL or filename.');
      return { filename: filename || null, fullUrl: fullUrl || null, name: file.name, type: file.type || '', size: file.size };
    },
    async deleteFile(filename) {
      const snapshot = sessionSnapshot();
      const name = /^https:\/\//i.test(String(filename)) ? filenameFromUrl(filename) : filename;
      const files = sdk().files;
      if (!name || !files || typeof files.delete !== 'function') throw new Error('The SDK does not expose deletion for this file.');
      await files.delete(name);
      assertSession(snapshot);
    },
    async subscribe(name, callback) {
      const snapshot = sessionSnapshot();
      const source = collection(name);
      if (typeof source.subscribe !== 'function') return null;
      const unsubscribe = await source.subscribe(event => {
        try { assertSession(snapshot); callback(event); } catch (_) { /* signed out or account changed */ }
      });
      try { assertSession(snapshot); }
      catch (error) { if (typeof unsubscribe === 'function') unsubscribe(); throw error; }
      return typeof unsubscribe === 'function' ? unsubscribe : null;
    },
  };

  window.addEventListener('storage', function (event) {
    if (event.key !== SESSION_KEY && event.key !== null) return;
    authVersion++;
    session = readSession();
    token = session === SDK_SESSION ? null : session;
    user = null;
    client = null;
    revision++;
    window.dispatchEvent(new CustomEvent('ledger-session-change'));
  });
  window.LedgerBackend = backend;
})(window);
