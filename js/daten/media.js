/* Medienbibliothek: verbindet Ordner mit den Pfaden aus den Nachrichten.
   Wege: Ordnerauswahl (input webkitdirectory), Drag & Drop eines Ordners,
   File System Access API (dauerhaft wiederverbindbar), Anhänge eines ZIP.

   Medienquellen: Jeder Import ist eine Quelle mit eigenen Medienordnern.
   WhatsApp benennt Dateien auf jedem Gerät gleich (IMG-20260925-WA0000.jpg) –
   ein gemeinsamer Index würde bei zwei Geräten das Bild des falschen Geräts
   zeigen. Deshalb sucht eine Nachricht nur in den Ordnern ihrer Quelle
   (m.medienQuelle). Hat die Quelle keine eigenen Ordner (ältere Importe,
   Ordner von Hand verbunden), wird überall gesucht – aber ein Treffer in
   mehreren Ordnern gilt als mehrdeutig und wird nicht angezeigt.

   Aufrufer übergeben einen Pfad oder eine Referenz {media, quelle} (Media.ref(m)). */
(function (global) {
  'use strict';

  const index = new Map();     // Pfad-Endung (klein) -> [Eintrag]
  const urlCache = new Map();  // Eintragspfad -> Object-URL
  const entries = [];
  const wurzeln = new Map();   // Quelle -> { id, label, handles: [], n }
  const ALLGEMEIN = 'allgemein';
  /* Ordner werden bis in diese Tiefe gelesen: In Extraktionen liegen Medien tief
     (WA_ADB_…/extraktion/data/media/0/Android/media/com.whatsapp/WhatsApp/Media/
     WhatsApp Images/Sent – im ALEAPP-Bericht noch eine Ebene tiefer). */
  const MAX_TIEFE = 24;
  const MAX_DATEIEN = 100000;
  const REGISTER = 'medienQuellen';
  let version = 0;             // erhöht sich bei jeder Änderung (für Neu-Rendern)

  /* ---- Quellen ----------------------------------------------------------- */

  /** Referenz auf das Medium einer Nachricht: mit Quelle, wenn sie eine hat */
  function ref(m) {
    if (!m) return '';
    return m.medienQuelle ? { media: m.media, quelle: m.medienQuelle } : m.media;
  }

  function zerlege(x, quelle) {
    if (x && typeof x === 'object') return { pfad: String(x.media || ''), quelle: x.quelle || '' };
    return { pfad: String(x || ''), quelle: quelle || '' };
  }

  function wurzel(id, label) {
    let w = wurzeln.get(id);
    if (!w) { w = { id, label: label || '', handles: [], n: 0 }; wurzeln.set(id, w); }
    else if (label && !w.label) w.label = label;
    return w;
  }

  /* Verzeichnis aller Importe (für Anzeige und Wiederverbinden), dauerhaft gemerkt */
  function quellen() {
    const r = Store.settings.get(REGISTER, []);
    return Array.isArray(r) ? r : [];
  }

  function merkeQuelle(q) {
    const liste = quellen().filter(x => x.id !== q.id);
    const alt = quellen().find(x => x.id === q.id) || {};
    liste.push(Object.assign({}, alt, q));
    Store.settings.set(REGISTER, liste);
  }

  function vergissQuelle(id) {
    Store.settings.set(REGISTER, quellen().filter(x => x.id !== id));
  }

  /** Neue Quelle für einen Import anlegen. */
  function neueQuelle(name, art) {
    const id = 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    merkeQuelle({ id, name: String(name || 'Import'), art: art || 'dateien', zeit: Date.now() });
    return id;
  }

  function quelleName(id) {
    if (!id || id === ALLGEMEIN) return 'Medienordner ohne Zuordnung';
    const q = quellen().find(x => x.id === id);
    return q ? q.name : id;
  }

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
    let p = String(path || '').toLowerCase();
    // Bei Internet-Links zählen ?Parameter und #Anker nicht zur Endung –
    // bei lokalen Dateien schon (dort dürfen # und ? im Namen stehen)
    if (/^https?:\/\//.test(p)) p = p.replace(/[?#].*$/, '');
    const m = p.match(/\.([a-z0-9]+)$/);
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

  function indexiere(entry) {
    const segs = entry.rel.split('/').filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      const key = segs.slice(i).join('/');
      let arr = index.get(key);
      if (!arr) { arr = []; index.set(key, arr); }
      arr.push(entry);
    }
  }

  function addEntry(relPath, source, quelle) {
    const norm = normPath(relPath);
    if (!norm) return;
    const w = quelle || ALLGEMEIN;
    const schluessel = w + '|' + norm;          // eindeutig je Quelle
    const existing = (index.get(norm) || []).find(e => e.path === schluessel);
    if (existing) {
      releaseURL(schluessel);
      existing.file = source.file || null;
      existing.handle = source.handle || null;
      existing.size = source.size || 0;
      existing.originalPath = relPath;
      return;
    }
    const segs = norm.split('/').filter(Boolean);
    const entry = {
      path: schluessel,
      rel: norm,
      wurzel: w,
      originalPath: relPath,
      name: segs[segs.length - 1],
      file: source.file || null,
      handle: source.handle || null,
      size: source.size || 0
    };
    entries.push(entry);
    wurzel(w).n++;
    indexiere(entry);
  }

  /**
   * Datei zu einem Pfad suchen. Längste passende Pfad-Endung gewinnt:
   * "C:\Export\Media\IMG.jpg" findet "media/img.jpg".
   * @returns {{entry: ?object, grund: string}} grund: '' | 'nicht-gefunden' | 'nicht-in-quelle' | 'mehrdeutig'
   */
  function treffer(x, quelleArg) {
    const { pfad, quelle } = zerlege(x, quelleArg);
    const norm = normPath(pfad);
    if (!norm || !index.size) return { entry: null, grund: 'nicht-gefunden' };
    const eigene = !!quelle && wurzeln.has(quelle) && wurzeln.get(quelle).n > 0;
    const segs = norm.split('/').filter(Boolean);
    for (let i = 0; i < segs.length; i++) {
      const arr = index.get(segs.slice(i).join('/'));
      if (!arr || !arr.length) continue;
      if (eigene) {
        const e = arr.find(y => y.wurzel === quelle);
        if (e) return { entry: e, grund: '' };
        continue;
      }
      // Ohne eigene Ordner: nur eindeutige Treffer
      if (new Set(arr.map(y => y.wurzel)).size > 1) return { entry: null, grund: 'mehrdeutig' };
      return { entry: arr[0], grund: '' };
    }
    return { entry: null, grund: eigene ? 'nicht-in-quelle' : 'nicht-gefunden' };
  }

  function lookup(x, quelle) { return treffer(x, quelle).entry; }

  /** Warum wurde nichts gefunden? Für die Meldung an der Kachel. */
  function grund(x, quelle) {
    const t = treffer(x, quelle);
    if (t.entry) return '';
    const { quelle: q } = zerlege(x, quelle);
    if (t.grund === 'mehrdeutig') return 'Die Datei liegt in mehreren Medienordnern – Medienordner für „' +
      quelleName(q) + '“ verbinden, damit eindeutig ist, welche gemeint ist.';
    if (t.grund === 'nicht-in-quelle') return 'Datei nicht im Medienordner von „' + quelleName(q) + '“.';
    return 'Datei nicht gefunden – Medienordner verbinden oder Datei erneut ablegen.';
  }

  async function getFile(entry) {
    if (entry.file) return entry.file;
    if (entry.handle) return entry.handle.getFile();
    return null;
  }

  async function getURL(x, quelle) {
    const entry = lookup(x, quelle);
    const path = zerlege(x).pfad;
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

  /* ---- Medien aus dem Internet ----------------------------------------
     Steht im Medienpfad ein http(s)-Link (GIF-Dienste, geteilte Bilder),
     wird die Datei nur mit Freigabe geladen: der fremde Server erfährt dabei
     die IP-Adresse dieses Rechners. Freigabe einzeln oder dauerhaft. */
  const einzelnFrei = new Set();

  function externErlaubt(path) {
    return Store.settings.get('externeMedien', false) === true || einzelnFrei.has(path);
  }
  function erlaubeExtern(path) { einzelnFrei.add(path); }
  function setzeExternImmer(ja) { Store.settings.set('externeMedien', !!ja); }

  /** Ist der Pfad ein Internet-Link ohne lokale Kopie im Medienordner? */
  function istExtern(x, quelle) { return !!Helfer.externeURL(zerlege(x).pfad) && !lookup(x, quelle); }

  const aufServerCache = new Map();
  function aufServer(url) {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return Promise.resolve(true);
    if (!aufServerCache.has(url)) {
      aufServerCache.set(url, fetch(url, { method: 'HEAD' }).then(r => r.ok, () => false));
    }
    return aufServerCache.get(url);
  }

  async function getDisplayURL(x, quelle) {
    if (lookup(x, quelle)) return getURL(x, quelle);   // lokale Kopie geht immer vor
    const path = zerlege(x).pfad;
    const extern = Helfer.externeURL(path);
    if (extern) return externErlaubt(path) ? extern : null;
    const url = Helfer.direkteURL(path);
    if (!url) return null;
    // Relativer Pfad, vom lokalen Server geladen (Beispieldaten, Export neben index.html):
    // nur, wenn es die Datei dort gibt – sonst zeigt die Kachel „Medienordner verbinden“
    if (!(await aufServer(url))) return null;
    if (extOf(path) !== 'gif') return url;
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

  /** Medienordner einer Quelle lösen – ohne Quelle: alle. Die Dateien selbst bleiben unberührt. */
  function clear(quelle) {
    const bleiben = quelle ? entries.filter(e => e.wurzel !== quelle) : [];
    for (const e of entries) if (!quelle || e.wurzel === quelle) releaseURL(e.path);
    if (!quelle) for (const path of urlCache.keys()) releaseURL(path);
    entries.length = 0;
    index.clear();
    if (quelle) wurzeln.delete(quelle); else wurzeln.clear();
    for (const e of bleiben) { entries.push(e); indexiere(e); }
    version++;
  }

  /** Ordner, die unter einer Quelle verbunden wurden, einer anderen zuschlagen. */
  function umhaengen(von, nach) {
    if (!wurzeln.has(von) || von === nach) return 0;
    const alt = wurzeln.get(von);
    const ziel = wurzel(nach, alt.label);
    let n = 0;
    for (const e of entries) {
      if (e.wurzel !== von) continue;
      releaseURL(e.path);
      e.wurzel = nach;
      e.path = nach + '|' + e.rel;
      n++;
    }
    ziel.n += n;
    ziel.handles.push(...alt.handles);
    wurzeln.delete(von);
    version++;
    return n;
  }

  /* ---- Weg 1: <input type="file" webkitdirectory> ------------------------ */
  function attachFileList(fileList, quelle) {
    let n = 0;
    const liste = Array.from(fileList || []);
    for (const f of liste) {
      addEntry(f.webkitRelativePath || f.name, { file: f, size: f.size }, quelle);
      n++;
    }
    if (n) {
      const rel = liste[0].webkitRelativePath || '';
      wurzel(quelle || ALLGEMEIN, rel ? rel.split('/')[0] : 'Dateien');
      version++;
    }
    return n;
  }

  /* ZIP-Anhänge werden erst beim Anzeigen entpackt, über getFile wie ein Ordner. */
  function attachSources(sources, label, quelle) {
    for (const source of sources) addEntry(source.path, source, quelle);
    if (sources.length) { wurzel(quelle || ALLGEMEIN, label || 'WhatsApp-Export'); version++; }
    return sources.length;
  }

  /* ---- Quelle 2: File System Access API (dauerhaft verknüpfbar) ---------- */
  async function scanHandle(dirHandle, prefix, depth, budget, quelle) {
    if (depth > MAX_TIEFE) { budget.zuTief = true; return 0; }
    let n = 0;
    for await (const [name, handle] of dirHandle.entries()) {
      if (budget.left <= 0) { budget.voll = true; return n; }
      const rel = prefix ? prefix + '/' + name : name;
      if (handle.kind === 'directory') {
        n += await scanHandle(handle, rel, depth + 1, budget, quelle);
      } else {
        addEntry(rel, { handle: handle }, quelle);
        budget.left--;
        n++;
      }
    }
    return n;
  }

  /* Nicht ganz gelesen? Für die Übersicht merken */
  function unvollstaendig(w, budget) {
    if (budget.voll) w.hinweis = 'nur die ersten ' + MAX_DATEIEN.toLocaleString('de-DE') + ' Dateien gelesen';
    else if (budget.zuTief) w.hinweis = 'Unterordner tiefer als ' + MAX_TIEFE + ' Ebenen nicht gelesen';
  }

  /** @param {{max?: number, quelle?: string}} [opts] */
  async function attachDirectoryHandle(handle, opts) {
    const quelle = (opts && opts.quelle) || ALLGEMEIN;
    const w = wurzel(quelle, handle.name || 'Medien');
    if (!w.handles.includes(handle)) w.handles.push(handle);
    const budget = { left: (opts && opts.max) || MAX_DATEIEN };
    const n = await scanHandle(handle, handle.name || '', 0, budget, quelle);
    unvollstaendig(w, budget);
    version++;
    return n;
  }

  /* ---- Quelle 3: Drag & Drop eines Ordners (webkitGetAsEntry) ------------ */
  function readEntries(reader) {
    return new Promise(resolve => reader.readEntries(r => resolve(r), () => resolve([])));
  }

  async function scanEntry(entry, prefix, depth, budget, quelle) {
    if (depth > MAX_TIEFE) { budget.zuTief = true; return 0; }
    if (budget.left <= 0) { budget.voll = true; return 0; }
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isFile) {
      const file = await new Promise(res => entry.file(res, () => res(null)));
      if (file) { addEntry(rel, { file: file, size: file.size }, quelle); budget.left--; return 1; }
      return 0;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      let n = 0, batch;
      do {
        batch = await readEntries(reader);
        for (const child of batch) n += await scanEntry(child, rel, depth + 1, budget, quelle);
      } while (batch.length);
      return n;
    }
    return 0;
  }

  async function attachDropEntry(entry, quelle) {
    const budget = { left: MAX_DATEIEN };
    const w = wurzel(quelle || ALLGEMEIN, entry.name);
    const n = await scanEntry(entry, '', 0, budget, quelle);
    unvollstaendig(w, budget);
    version++;
    return n;
  }

  function listByExt(exts, quelle) {
    const set = exts.map(e => e.toLowerCase());
    return entries.filter(e => set.indexOf(extOf(e.name)) !== -1 && (!quelle || e.wurzel === quelle));
  }

  /** Zahlen für Meldungen und die Übersicht – gesamt und je Quelle */
  function stats(messages) {
    let withMedia = 0, matched = 0, mehrdeutig = 0;
    const jeQuelle = new Map();
    for (const m of messages) {
      if (!m.media || Helfer.externeURL(m.media)) continue;
      const q = m.medienQuelle || '';
      if (!jeQuelle.has(q)) jeQuelle.set(q, { quelle: q, withMedia: 0, matched: 0, mehrdeutig: 0, fehlend: [] });
      const z = jeQuelle.get(q);
      withMedia++; z.withMedia++;
      const t = treffer(ref(m));
      if (t.entry) { matched++; z.matched++; continue; }
      if (t.grund === 'mehrdeutig') { mehrdeutig++; z.mehrdeutig++; }
      if (z.fehlend.length < 200) z.fehlend.push(m.media);
    }
    return { files: entries.length, withMedia, matched, mehrdeutig, jeQuelle };
  }

  global.Media = {
    kindOf: kindOf, extOf: extOf, mimeType: mimeType, isAnimation: isAnimation, loopingGif: loopingGif,
    lookup: lookup, grund: grund, ref: ref, getURL: getURL, getDisplayURL: getDisplayURL, getFile: getFile,
    istExtern: istExtern, externErlaubt: externErlaubt, erlaubeExtern: erlaubeExtern, setzeExternImmer: setzeExternImmer,
    attachFileList: attachFileList, attachSources: attachSources,
    attachDirectoryHandle: attachDirectoryHandle, attachDropEntry: attachDropEntry,
    clear: clear, umhaengen: umhaengen, stats: stats, listByExt: listByExt,
    neueQuelle: neueQuelle, merkeQuelle: merkeQuelle, vergissQuelle: vergissQuelle, quellen: quellen,
    quelleName: quelleName, ALLGEMEIN: ALLGEMEIN,
    hatOrdner: id => wurzeln.has(id) && wurzeln.get(id).n > 0,
    eintraege: quelle => entries.filter(e => e.wurzel === quelle),
    ordner: () => Array.from(wurzeln.values()).filter(w => w.n > 0)
      .map(w => ({ id: w.id, label: w.label, n: w.n, handles: w.handles.slice(), hinweis: w.hinweis || '' })),
    count: quelle => quelle ? (wurzeln.has(quelle) ? wurzeln.get(quelle).n : 0) : entries.length,
    label: () => Array.from(wurzeln.values()).filter(w => w.n > 0).map(w => w.label).join(', '),
    version: () => version,
    supportsPicker: () => typeof global.showDirectoryPicker === 'function'
  };
})(window);
