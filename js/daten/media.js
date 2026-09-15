/* Medienbibliothek: verbindet einen Ordner mit den Pfaden aus der CSV.
   Quellen: Ordnerauswahl (input webkitdirectory), Drag & Drop eines Ordners,
   oder File System Access API (dauerhaft wiederverbindbar). */
(function (global) {
  'use strict';

  const index = new Map();     // Pfad-Endung (klein) -> [Eintrag]
  const urlCache = new Map();  // Eintragspfad -> Object-URL
  const entries = [];
  let rootLabel = '';
  let rootHandle = null;
  let version = 0;             // erhöht sich bei jeder Änderung (für Neu-Rendern)

  const EXT_IMG = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'heic', 'heif'];
  const EXT_VID = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp', 'mpg', 'mpeg'];
  const EXT_AUD = ['ogg', 'opus', 'oga', 'mp3', 'm4a', 'aac', 'wav', 'amr', 'flac', 'wma'];

  function extOf(path) {
    const m = String(path || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  /* Art der Datei: bevorzugt der Typ aus der CSV, sonst die Dateiendung */
  function kindOf(type, path) {
    const e = extOf(path);
    if (type === 'bild' || type === 'video' || type === 'audio') {
      // Widersprüche zugunsten der Endung auflösen (z. B. Typ "bild", Datei .mp4)
      if (EXT_VID.indexOf(e) !== -1) return 'video';
      if (EXT_AUD.indexOf(e) !== -1) return 'audio';
      if (EXT_IMG.indexOf(e) !== -1) return 'bild';
      return type;
    }
    if (EXT_IMG.indexOf(e) !== -1) return 'bild';
    if (EXT_VID.indexOf(e) !== -1) return 'video';
    if (EXT_AUD.indexOf(e) !== -1) return 'audio';
    return 'datei';
  }

  function normPath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').toLowerCase().trim();
  }

  function addEntry(relPath, source) {
    const norm = normPath(relPath);
    if (!norm) return;
    const segs = norm.split('/').filter(Boolean);
    const entry = {
      path: norm,
      name: segs[segs.length - 1],
      file: source.file || null,
      handle: source.handle || null,
      size: source.size || 0
    };
    entries.push(entry);
    for (let i = segs.length - 1; i >= 0; i--) {
      const key = segs.slice(i).join('/');
      let arr = index.get(key);
      if (!arr) { arr = []; index.set(key, arr); }
      arr.push(entry);
    }
  }

  /* Längste passende Pfad-Endung gewinnt: "C:\Export\Media\IMG.jpg" findet "media/img.jpg" */
  function lookup(path) {
    const norm = normPath(path);
    if (!norm || !index.size) return null;
    const segs = norm.split('/').filter(Boolean);
    for (let i = 0; i < segs.length; i++) {
      const arr = index.get(segs.slice(i).join('/'));
      if (arr && arr.length) return arr[0];
    }
    return null;
  }

  async function getFile(entry) {
    if (entry.file) return entry.file;
    if (entry.handle) return entry.handle.getFile();
    return null;
  }

  async function getURL(path) {
    const entry = lookup(path);
    if (!entry) return null;
    if (urlCache.has(entry.path)) return urlCache.get(entry.path);
    try {
      const file = await getFile(entry);
      if (!file) return null;
      const url = URL.createObjectURL(file);
      urlCache.set(entry.path, url);
      return url;
    } catch (e) { return null; }
  }

  function clear() {
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
    index.clear();
    entries.length = 0;
    rootLabel = '';
    rootHandle = null;
    version++;
  }

  /* ---- Quelle 1: <input type="file" webkitdirectory> --------------------- */
  function attachFileList(fileList) {
    let n = 0;
    for (const f of Array.from(fileList || [])) {
      addEntry(f.webkitRelativePath || f.name, { file: f, size: f.size });
      n++;
    }
    if (n) {
      const first = fileList[0];
      const rel = first.webkitRelativePath || '';
      rootLabel = rootLabel || (rel ? rel.split('/')[0] : 'Medien');
      version++;
    }
    return n;
  }

  /* ---- Quelle 2: File System Access API (dauerhaft verknüpfbar) ---------- */
  async function scanHandle(dirHandle, prefix, depth, budget) {
    if (depth > 8) return 0;
    let n = 0;
    for await (const [name, handle] of dirHandle.entries()) {
      if (budget.left <= 0) return n;
      const rel = prefix ? prefix + '/' + name : name;
      if (handle.kind === 'directory') {
        n += await scanHandle(handle, rel, depth + 1, budget);
      } else {
        addEntry(rel, { handle: handle });
        budget.left--;
        n++;
      }
    }
    return n;
  }

  async function attachDirectoryHandle(handle, opts) {
    rootHandle = handle;
    rootLabel = handle.name || 'Medien';
    const budget = { left: (opts && opts.max) || 50000 };
    const n = await scanHandle(handle, handle.name || '', 0, budget);
    version++;
    return n;
  }

  /* ---- Quelle 3: Drag & Drop eines Ordners (webkitGetAsEntry) ------------ */
  function readEntries(reader) {
    return new Promise(resolve => reader.readEntries(r => resolve(r), () => resolve([])));
  }

  async function scanEntry(entry, prefix, depth, budget) {
    if (depth > 8 || budget.left <= 0) return 0;
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isFile) {
      const file = await new Promise(res => entry.file(res, () => res(null)));
      if (file) { addEntry(rel, { file: file, size: file.size }); budget.left--; return 1; }
      return 0;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      let n = 0, batch;
      do {
        batch = await readEntries(reader);
        for (const child of batch) n += await scanEntry(child, rel, depth + 1, budget);
      } while (batch.length);
      return n;
    }
    return 0;
  }

  async function attachDropEntry(entry) {
    const budget = { left: 50000 };
    rootLabel = rootLabel || entry.name;
    const n = await scanEntry(entry, '', 0, budget);
    version++;
    return n;
  }

  function listByExt(exts) {
    const set = exts.map(e => e.toLowerCase());
    return entries.filter(e => set.indexOf(extOf(e.name)) !== -1);
  }

  function stats(messages) {
    let withMedia = 0, matched = 0;
    for (const m of messages) {
      if (!m.media) continue;
      withMedia++;
      if (lookup(m.media)) matched++;
    }
    return { files: entries.length, withMedia: withMedia, matched: matched };
  }

  global.Media = {
    kindOf: kindOf, extOf: extOf,
    lookup: lookup, getURL: getURL, getFile: getFile,
    attachFileList: attachFileList, attachDirectoryHandle: attachDirectoryHandle, attachDropEntry: attachDropEntry,
    clear: clear, stats: stats, listByExt: listByExt,
    count: () => entries.length,
    label: () => rootLabel,
    handle: () => rootHandle,
    version: () => version,
    supportsPicker: () => typeof global.showDirectoryPicker === 'function'
  };
})(window);
