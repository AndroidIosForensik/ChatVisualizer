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
  const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp',
    heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', m4v: 'video/mp4',
    mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp',
    opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg',
    m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', amr: 'audio/amr',
    pdf: 'application/pdf', txt: 'text/plain'
  };

  function extOf(path) {
    const m = String(path || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function mimeType(path) { return MIME[extOf(path)] || ''; }

  /* WhatsApp-GIFs können als 00001234-GIF-….mp4 exportiert sein.
     Normale Videos bleiben bedienbare Videos, auch wenn sie kurz sind. */
  function isAnimation(type, path) {
    const name = String(path || '').split(/[\\/]/).pop();
    return extOf(path) === 'gif' || /^(gif|animation|animated[_ -]?gif)$/i.test(type || '') ||
      (EXT_VID.includes(extOf(path)) && /(?:^|[-_. ])gif(?:[-_. ]|$)/i.test(name));
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
    return String(p || '').normalize('NFC').replace(/[\u00a0\u202f]/g, ' ')
      .replace(/[\u200e\u200f]/g, '').replace(/\\/g, '/')
      .replace(/^\.\//, '').replace(/\/+/g, '/').toLowerCase().trim();
  }

  function releaseURL(path) {
    const pending = urlCache.get(path);
    urlCache.delete(path);
    if (pending) pending.then(url => { if (url) URL.revokeObjectURL(url); });
  }

  function addEntry(relPath, source) {
    const norm = normPath(relPath);
    if (!norm) return;
    const existing = (index.get(norm) || []).find(e => e.path === norm);
    if (existing) {
      releaseURL(norm);
      existing.file = source.file || null;
      existing.handle = source.handle || null;
      existing.size = source.size || 0;
      existing.originalPath = relPath;
      return;
    }
    const segs = norm.split('/').filter(Boolean);
    const entry = {
      path: norm,
      originalPath: relPath,
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
    if (urlCache.has(entry.path)) {
      const pending = urlCache.get(entry.path);
      const url = await pending;
      return urlCache.get(entry.path) === pending ? url : null;
    }
    // Chat, Vorschau und Großansicht teilen denselben laufenden Ladevorgang.
    const pending = (async () => {
      try {
        const file = await getFile(entry);
        if (!file) return null;
        const mime = mimeType(path);
        let blob = mime && file.type !== mime ? file.slice(0, file.size, mime) : file;
        if (extOf(path) === 'gif') blob = await loopingGif(blob);
        return URL.createObjectURL(blob);
      } catch (e) { return null; }
    })();
    urlCache.set(entry.path, pending);
    const url = await pending;
    if (!url && urlCache.get(entry.path) === pending) urlCache.delete(entry.path);
    return urlCache.get(entry.path) === pending ? url : null;
  }

  async function getDisplayURL(path) {
    if (lookup(path)) return getURL(path);
    const url = Helfer.direkteURL(path);
    if (!url || extOf(path) !== 'gif') return url;
    const key = '@direct:' + url;
    if (!urlCache.has(key)) {
      const pending = (async () => {
        try {
          const response = await fetch(url);
          if (!response.ok) return url;
          return URL.createObjectURL(await loopingGif(await response.blob()));
        } catch (e) { return url; } // file:// kann img erlauben, aber fetch verweigern
      })();
      urlCache.set(key, pending);
    }
    const pending = urlCache.get(key);
    const result = await pending;
    if (urlCache.get(key) !== pending) return null;
    if (!result) urlCache.delete(key);
    return result;
  }

  /* Eine GIF-Datei kann einmaliges Abspielen vorgeben. Nur den Loop-Eintrag
     ändern/ergänzen; Bilddaten, Timing und Transparenz bleiben unverändert. */
  async function loopingGif(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 13 || !/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.subarray(0, 6)))) return blob;
    const start = 13 + ((bytes[10] & 128) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
    let pos = start;
    let found = false;
    while (pos < bytes.length) {
      const marker = bytes[pos++];
      if (marker === 0x3b) break;
      if (marker === 0x21) {
        const label = bytes[pos++];
        const length = bytes[pos];
        if (label === 0xff && length === 11) {
          const app = new TextDecoder().decode(bytes.subarray(pos + 1, pos + 12));
          if ((app === 'NETSCAPE2.0' || app === 'ANIMEXTS1.0') && bytes[pos + 12] === 3 && bytes[pos + 13] === 1) {
            if (pos + 15 >= bytes.length) return blob;
            bytes[pos + 14] = bytes[pos + 15] = 0;
            found = true;
          }
        }
      } else if (marker === 0x2c) {
        if (pos + 9 > bytes.length) return blob;
        const packed = bytes[pos + 8];
        pos += 9 + ((packed & 128) ? 3 * (1 << ((packed & 7) + 1)) : 0);
        pos++; // LZW-Codegröße
      } else return blob;
      while (pos < bytes.length && bytes[pos]) pos += bytes[pos] + 1;
      pos++; // Ende der Unterblöcke
    }
    if (pos > bytes.length || start > bytes.length) return blob;
    if (found) return new Blob([bytes], { type: 'image/gif' });
    const loop = new Uint8Array([33, 255, 11, ...Array.from('NETSCAPE2.0', c => c.charCodeAt(0)), 3, 1, 0, 0, 0]);
    return new Blob([bytes.subarray(0, start), loop, bytes.subarray(start)], { type: 'image/gif' });
  }

  function clear() {
    for (const path of urlCache.keys()) releaseURL(path);
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

  /* ZIP-Anhänge werden erst beim Anzeigen entpackt, über getFile wie ein Ordner. */
  function attachSources(sources, label) {
    for (const source of sources) addEntry(source.path, source);
    if (sources.length) { rootLabel = label || 'WhatsApp-Export'; version++; }
    return sources.length;
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
    kindOf: kindOf, extOf: extOf, mimeType: mimeType, isAnimation: isAnimation, loopingGif: loopingGif,
    lookup: lookup, getURL: getURL, getDisplayURL: getDisplayURL, getFile: getFile,
    attachFileList: attachFileList, attachSources: attachSources,
    attachDirectoryHandle: attachDirectoryHandle, attachDropEntry: attachDropEntry,
    clear: clear, stats: stats, listByExt: listByExt,
    count: () => entries.length,
    label: () => rootLabel,
    handle: () => rootHandle,
    version: () => version,
    supportsPicker: () => typeof global.showDirectoryPicker === 'function'
  };
})(window);
