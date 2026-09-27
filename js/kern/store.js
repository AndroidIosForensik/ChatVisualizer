/* Persistenz: IndexedDB (ein Eintrag je Unterhaltung), Einstellungen via localStorage */
(function (global) {
  'use strict';

  const DB_NAME = 'chatvisualizer';
  const DB_VERSION = 6;
  const STORE = 'chats';
  const HANDLES = 'handles';
  const TRANS = 'translations';
  const SCRIPTS = 'transcripts';
  const DOCS = 'documents';
  let dbPromise = null;
  let available = true;

  /* Nur die reinen Datenfelder speichern (keine Laufzeit-Verweise) */
  const FIELDS = ['key', 'id', 'messenger', 'conv', 'convKey', 'ts', 'tsRaw',
                  'sender', 'text', 'type', 'media', 'replyTo', 'reactionTo', 'status', 'sourceOrder', 'convName', 'fromMe'];

  function plain(m) {
    const o = {};
    for (const f of FIELDS) o[f] = m[f];
    return o;
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { available = false; return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains('messages')) db.deleteObjectStore('messages');
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'convKey' });
        if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
        if (!db.objectStoreNames.contains(TRANS)) db.createObjectStore(TRANS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(SCRIPTS)) db.createObjectStore(SCRIPTS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { available = false; resolve(null); };
      req.onblocked = () => resolve(null);
    }).catch(() => { available = false; return null; });
    return dbPromise;
  }

  /* records: [{ convKey, messages: [...] }] – ersetzt die jeweilige Unterhaltung komplett */
  async function putConversations(records) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(STORE, 'readwrite'); }
      catch (e) { return resolve(false); }
      const os = tx.objectStore(STORE);
      for (const r of records) {
        os.put({ convKey: r.convKey, messages: r.messages.map(plain) });
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }

  async function getAll() {
    const db = await openDB();
    if (!db) return [];
    const records = await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    const out = [];
    for (const r of records) {
      if (r && r.messages) for (const m of r.messages) out.push(m);
    }
    return out;
  }

  async function deleteConv(convKey) {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(convKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async function clear() {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /* Übersetzungen: ein Eintrag je Nachricht und Zielsprache */
  async function putTranslations(rows) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(TRANS, 'readwrite'); }
      catch (e) { return resolve(false); }
      const os = tx.objectStore(TRANS);
      for (const r of rows) os.put(r);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }

  async function getTranslations() {
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(TRANS, 'readonly'); }
      catch (e) { return resolve([]); }
      const req = tx.objectStore(TRANS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function deleteTranslations(keys) {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(TRANS, 'readwrite');
      const os = tx.objectStore(TRANS);
      for (const k of keys) os.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async function clearTranslations() {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(TRANS, 'readwrite');
      tx.objectStore(TRANS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /* Transkripte von Sprachnachrichten */
  async function putTranscripts(rows) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(SCRIPTS, 'readwrite'); }
      catch (e) { return resolve(false); }
      const os = tx.objectStore(SCRIPTS);
      for (const r of rows) os.put(r);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }

  async function getTranscripts() {
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(SCRIPTS, 'readonly'); }
      catch (e) { return resolve([]); }
      const req = tx.objectStore(SCRIPTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function deleteTranscripts(keys) {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(SCRIPTS, 'readwrite');
      const os = tx.objectStore(SCRIPTS);
      for (const k of keys) os.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async function clearTranscripts() {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(SCRIPTS, 'readwrite');
      tx.objectStore(SCRIPTS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /* Ausgelesene Dokumente (PDF-Text und Vorschaubild) */
  async function putDocuments(rows) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(DOCS, 'readwrite'); }
      catch (e) { return resolve(false); }
      const os = tx.objectStore(DOCS);
      for (const r of rows) os.put(r);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }

  async function getDocuments() {
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(DOCS, 'readonly'); }
      catch (e) { return resolve([]); }
      const req = tx.objectStore(DOCS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function clearDocuments() {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(DOCS, 'readwrite');
      tx.objectStore(DOCS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /* Verzeichnis-Handles der File System Access API überleben einen Neustart */
  async function saveHandle(name, handle) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(HANDLES, 'readwrite'); }
      catch (e) { return resolve(false); }
      try { tx.objectStore(HANDLES).put(handle, name); }
      catch (e) { return resolve(false); }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }

  async function getHandle(name) {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      let tx;
      try { tx = db.transaction(HANDLES, 'readonly'); }
      catch (e) { return resolve(null); }
      const req = tx.objectStore(HANDLES).get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  async function deleteHandle(name) {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(HANDLES, 'readwrite');
      tx.objectStore(HANDLES).delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  const settings = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('cv.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('cv.' + key, JSON.stringify(value)); } catch (e) {}
    }
  };

  global.Store = {
    putConversations: putConversations, getAll: getAll, deleteConv: deleteConv,
    clear: clear, settings: settings, isAvailable: () => available,
    saveHandle: saveHandle, getHandle: getHandle, deleteHandle: deleteHandle,
    putTranslations: putTranslations, getTranslations: getTranslations,
    deleteTranslations: deleteTranslations, clearTranslations: clearTranslations,
    putTranscripts: putTranscripts, getTranscripts: getTranscripts,
    deleteTranscripts: deleteTranscripts, clearTranscripts: clearTranscripts,
    putDocuments: putDocuments, getDocuments: getDocuments, clearDocuments: clearDocuments
  };
})(window);
