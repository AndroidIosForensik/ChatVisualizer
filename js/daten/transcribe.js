/* Sprachnachrichten transkribieren – vollständig lokal.
   Verfahren 1: mitgeliefertes Whisper-Modell (ONNX über transformers.js im Arbeiter-Thread)
                – liegt im Ordner modelle/, läuft ohne Installation und ohne Netz
   Verfahren 2: eingebaute Prompt-API von Chrome (LanguageModel mit Audio-Eingabe),
                falls der Browser sie freigegeben hat
   Die Audiodatei kommt aus dem verbundenen Medienordner. */
(function (global) {
  'use strict';

  const MODELLE = {
    'Xenova/whisper-small': 'Whisper small – genau',
    'Xenova/whisper-base': 'Whisper base – schneller, ungenauer'
  };

  /* Sprachen, die Whisper kennt (lang_to_id in generation_config.json des Modells).
     HAEUFIG steht im Auswahlfeld oben, der Rest darunter. */
  const SPRACHEN = ('af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr ' +
    'gl gu haw ha he hi hr ht hu hy id is it ja jw ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn ' +
    'mr ms mt my ne nl nn no oc pa pl ps pt ro ru sa sd si sk sl sn so sq sr su sv sw ta te tg th tk ' +
    'tl tr tt uk ur uz vi yi yo zh').split(' ');
  const HAEUFIG = ['de', 'en', 'ru', 'uk', 'pl', 'ro', 'bg', 'lt', 'lv', 'cs', 'sk', 'hu',
    'sq', 'sr', 'hr', 'bs', 'mk', 'tr', 'ka', 'hy', 'az', 'ar', 'fa', 'ps', 'ur', 'hi',
    'vi', 'zh', 'th', 'so', 'am', 'it', 'fr', 'es', 'pt', 'nl'];
  // Codes der Spracherkennung des Browsers, die Whisper anders schreibt
  const ALIAS = { nb: 'no', iw: 'he', jv: 'jw', fil: 'tl' };

  /** Sprachcode für Whisper oder '' (zh-Hant → zh, nb → no; Unbekanntes → ''). */
  function whisperSprache(code) {
    const c = String(code || '').split('-')[0].toLowerCase();
    const w = ALIAS[c] || c;
    return SPRACHEN.includes(w) ? w : '';
  }

  /* Es wird nur angeboten, was auch im Ordner modelle/ liegt.
     modelle/verzeichnis.json sagt, was da ist – inklusive Gesamtgröße für die
     Fortschrittsanzeige; notfalls wird nachgesehen. */
  let installiert = null;
  const modellGroesse = new Map();

  function modelBytes(name) { return modellGroesse.get(name) || 0; }

  async function installedModels() {
    if (installiert) return installiert;
    try {
      const r = await withTimeout(fetch('modelle/verzeichnis.json'), 4000, 'Modellverzeichnis');
      if (r.ok) {
        const j = await r.json();
        const liste = (j.modelle || []).map(e => {
          if (typeof e === 'string') return e;
          if (e && e.name) { if (e.bytes) modellGroesse.set(e.name, e.bytes); return e.name; }
          return null;
        }).filter(Boolean);
        if (liste.length) {
          installiert = liste;
          return installiert;
        }
      }
    } catch (e) { /* dann eben nachsehen */ }

    const da = [];
    for (const name of Object.keys(MODELLE)) {
      try {
        const r = await withTimeout(fetch('modelle/' + name + '/config.json', { method: 'HEAD' }), 4000, 'Modellordner');
        if (r.ok) da.push(name);
      } catch (e) { /* nicht vorhanden */ }
    }
    installiert = da;
    return da;
  }

  const settings = {
    engine:   Store.settings.get('scEngine', 'bundled'),          // bundled | prompt
    model:    Store.settings.get('scModel', 'Xenova/whisper-small'),
    language: Store.settings.get('scLanguage', 'auto')            // auto | ISO-Code
  };

  function saveSettings() {
    Store.settings.set('scEngine', settings.engine);
    Store.settings.set('scModel', settings.model);
    Store.settings.set('scLanguage', settings.language);
  }

  /* Whisper braucht die Ausgangssprache: ohne Angabe setzt die Laufzeit hart auf
     Englisch und übersetzt dann, statt zu transkribieren. Die Sprache kommt deshalb
     aus den Textnachrichten derselben Unterhaltung (siehe translate.js) – oder,
     falls dort für den Chat eine Ausgangssprache fest gewählt ist, aus dieser. */
  async function guessLanguage(conv, m) {
    if (settings.language !== 'auto') return settings.language;
    return whisperSprache(conv && Translate.sourceFor(conv.key)) ||
      whisperSprache(await Translate.conversationLanguage(conv, m)) || Translate.settings.target;
  }

  const PROMPT = 'Transkribiere diese Sprachnachricht wortgetreu. ' +
    'Gib ausschließlich den gesprochenen Text zurück, in der Sprache, in der gesprochen wird – ' +
    'keine Übersetzung, keine Zusammenfassung, keine Anführungszeichen, keine Erklärung. ' +
    'Ist nichts Verständliches zu hören, antworte mit einem Bindestrich.';

  const CHUNK_SECONDS = 20;     // die Prompt-API nimmt nur kurze Ausschnitte
  const TARGET_RATE = 16000;    // Spracherkennung arbeitet mit 16 kHz mono

  /* ------------------------------------------------------------------ *
   * Zwischenspeicher
   * ------------------------------------------------------------------ */
  const cache = new Map();      // msgKey -> { t, ms, e }
  let pending = [];
  let saveTimer = null;

  function get(msgKey) { return cache.get(msgKey) || null; }
  function text(msgKey) { const e = cache.get(msgKey); return e && e.t ? e.t : ''; }

  function put(msgKey, entry) {
    cache.set(msgKey, entry);
    pending.push({ key: msgKey, t: entry.t, ms: entry.ms, e: entry.e, l: entry.l || '' });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  }

  async function flush() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    await Store.putTranscripts(batch);
  }

  async function load() {
    const rows = await Store.getTranscripts();
    for (const r of rows) cache.set(r.key, { t: r.t, ms: r.ms, e: r.e, l: r.l || '' });
    return cache.size;
  }

  async function clearFor(msgKeys) {
    for (const k of msgKeys) cache.delete(k);
    await Store.deleteTranscripts(msgKeys);
  }

  async function clearAll() {
    cache.clear();
    pending = [];
    await Store.clearTranscripts();
  }

  /* ------------------------------------------------------------------ *
   * Hilfsmittel
   * ------------------------------------------------------------------ */
  /* Zeitlimit für hängende Browser-Schnittstellen – siehe kern/helfer.js */
  const withTimeout = Helfer.withTimeout;

  function isVoice(m) {
    if (!m || !m.media) return false;
    return Media.kindOf(m.type, m.media) === 'audio';
  }

  function pendingMessages(conv) {
    return conv.messages.filter(m => isVoice(m) && !get(m.key) && audioSource(m));
  }

  /* Datei aus der Medienbibliothek oder – bei relativem Pfad – vom lokalen Server */
  function audioSource(m) {
    const entry = Media.lookup(Media.ref(m));
    if (entry) return { entry: entry };
    const url = Helfer.direkteURL(m.media);
    return url ? { url: url } : null;
  }

  async function audioBlob(m) {
    const src = audioSource(m);
    if (!src) throw new Error('Audiodatei nicht gefunden – Medienordner verbinden');
    if (src.entry) {
      const file = await Media.getFile(src.entry);
      if (!file) throw new Error('Audiodatei nicht lesbar');
      return file;
    }
    const r = await fetch(src.url);
    if (!r.ok) throw new Error('Audiodatei nicht erreichbar (HTTP ' + r.status + ')');
    return r.blob();
  }

  /* ------------------------------------------------------------------ *
   * Audio aufbereiten: mono, 16 kHz
   * ------------------------------------------------------------------ */
  async function prepare(blob) {
    const Ctx = global.AudioContext || global.webkitAudioContext;
    const Offline = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!Ctx || !Offline) throw new Error('Dieser Browser kann kein Audio dekodieren');

    const ctx = new Ctx();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch (e) {
      throw new Error('Audioformat wird vom Browser nicht unterstützt');
    } finally {
      try { ctx.close(); } catch (e) {}
    }

    const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const octx = new Offline(1, length, TARGET_RATE);
    const src = octx.createBufferSource();
    src.buffer = decoded;
    src.connect(octx.destination);
    src.start();
    const mono = await octx.startRendering();
    return { data: mono.getChannelData(0), duration: decoded.duration };
  }

  /* Schnitt möglichst in eine leise Stelle legen, damit keine Wörter zerreißen */
  function quietCut(data, wish, window) {
    const from = Math.max(0, wish - window), to = Math.min(data.length, wish + window);
    if (to - from < TARGET_RATE * 0.2) return wish;
    const step = Math.floor(TARGET_RATE * 0.02);
    let best = wish, bestEnergy = Infinity;
    for (let i = from; i + step < to; i += step) {
      let sum = 0;
      for (let j = i; j < i + step; j++) sum += data[j] * data[j];
      if (sum < bestEnergy) { bestEnergy = sum; best = i + (step >> 1); }
    }
    return best;
  }

  /* Ausschnitte als AudioBuffer – nur die Prompt-API braucht das */
  function slices(data) {
    const out = [];
    const size = CHUNK_SECONDS * TARGET_RATE;
    let pos = 0;
    while (pos < data.length) {
      let end = Math.min(data.length, pos + size);
      if (end < data.length) end = quietCut(data, end, Math.floor(TARGET_RATE * 1.5));
      const part = new AudioBuffer({ length: end - pos, numberOfChannels: 1, sampleRate: TARGET_RATE });
      part.copyToChannel(data.subarray(pos, end), 0);
      out.push(part);
      pos = end;
    }
    return out;
  }

  function cleanup(s) {
    let out = String(s || '').trim();
    out = out.replace(/^```[a-z]*\s*|\s*```$/g, '');
    out = out.replace(/^(Transkript|Transkription|Text)\s*:\s*/i, '');
    if (out.length > 1 && /^["„»']/.test(out) && /["“«']$/.test(out)) out = out.slice(1, -1);
    out = out.trim();
    if (/^[-–—.]?$/.test(out)) return '';          // nichts Verständliches
    return out;
  }

  let downloadCb = null;
  function onDownloadProgress(cb) { downloadCb = cb; }

  /* ------------------------------------------------------------------ *
   * Verfahren 1: mitgeliefertes Whisper-Modell im Arbeiter-Thread
   * ------------------------------------------------------------------ */
  const whisper = {
    worker: null, seq: 0, waiting: new Map(), state: 'unknown', error: '',

    boot() {
      if (this.worker) return this.worker;
      try {
        // Pfad ist relativ zur Seite (index.html), nicht zu dieser Datei
        this.worker = new Worker('js/daten/transcribe-worker.js', { type: 'module' });
      } catch (e) {
        this.state = 'no';
        this.error = 'Arbeiter-Thread nicht möglich (' + (e.message || e) + ')';
        return null;
      }
      this.worker.onmessage = ev => {
        const m = ev.data || {};
        if (m.type === 'result' || m.type === 'pong') {
          const w = this.waiting.get(m.id);
          if (w) {
            this.waiting.delete(m.id);
            if (m.type === 'pong' || m.ok) w.resolve(m.text !== undefined ? m.text : '');
            else w.reject(new Error(m.error || 'Transkription fehlgeschlagen'));
          }
          return;
        }
        if (m.type === 'loading' && downloadCb) downloadCb('Modell wird geladen', 0);
        else if (m.type === 'progress' && downloadCb) {
          const gesamt = modelBytes(m.model);
          const mb = b => (b / 1048576).toFixed(0);
          if (gesamt) {
            downloadCb('Modell wird geladen · ' + mb(m.bytes) + ' von ' + mb(gesamt) + ' MB',
              Math.min(100, Math.round(m.bytes / gesamt * 100)));
          } else {
            downloadCb('Modell wird geladen · ' + mb(m.bytes) + ' MB', -1);
          }
        }
      };
      this.worker.onerror = e => {
        this.state = 'no';
        this.error = 'Modell konnte nicht geladen werden' + (e.message ? ' (' + e.message + ')' : '');
        for (const w of this.waiting.values()) w.reject(new Error(this.error));
        this.waiting.clear();
        try { this.worker.terminate(); } catch (err) {}
        this.worker = null;
      };
      return this.worker;
    },

    send(msg, timeoutMs) {
      const w = this.boot();
      if (!w) return Promise.reject(new Error(this.error || 'Arbeiter-Thread fehlt'));
      const id = ++this.seq;
      const p = new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
      w.postMessage(Object.assign({ id: id }, msg));
      return withTimeout(p, timeoutMs, 'Spracherkennung').catch(err => {
        this.waiting.delete(id);
        throw err;
      });
    },

    async ready() {
      if (this.state === 'ok') return true;
      if (this.state === 'no') return false;
      try {
        // Auf ein tatsächlich vorhandenes Modell zurückfallen
        const da = await installedModels();
        if (da.length && da.indexOf(settings.model) === -1) {
          settings.model = da[0];
          saveSettings();
        }
        const r = await withTimeout(
          fetch('modelle/' + settings.model + '/config.json', { method: 'HEAD' }), 4000, 'Modellordner');
        if (!r.ok) throw new Error('Modelldateien fehlen im Ordner modelle/' + settings.model);
        await this.send({ type: 'ping' }, 20000);
        this.state = 'ok';
        return true;
      } catch (e) {
        this.state = 'no';
        this.error = e.message || String(e);
        return false;
      }
    },

    async transcribe(prep, language) {
      // Kopie senden, damit der Aufrufer die Daten behält
      const audio = new Float32Array(prep.data);
      const grosszuegig = Math.max(120000, Math.round(prep.duration * 12000));
      const text = await this.send({
        type: 'transcribe', model: settings.model, audio: audio, language: language
      }, grosszuegig);
      return cleanup(text);
    }
  };

  /* ------------------------------------------------------------------ *
   * Verfahren 2: Prompt-API von Chrome
   * ------------------------------------------------------------------ */
  const FLAGS_HINT =
    'Chrome muss die Prompt-API mit Audio freigeben:\n' +
    '1. chrome://flags → „Prompt API for Gemini Nano" auf Enabled\n' +
    '2. chrome://flags → „Prompt API for Gemini Nano with Multimodal Input" auf Enabled\n' +
    '3. Chrome neu starten\n' +
    '4. chrome://components → „Optimization Guide On Device Model" → Nach Update suchen\n' +
    'Voraussetzungen: Windows 10/11 oder macOS, mindestens 22 GB freier Speicherplatz, ' +
    'GPU mit 4 GB VRAM und eine Verbindung ohne Datensparmodus.';

  const promptApi = {
    audio: '', text: '', error: '',

    async availability(withAudio) {
      try {
        const opts = withAudio ? { expectedInputs: [{ type: 'audio' }] } : undefined;
        return await withTimeout(LanguageModel.availability(opts), 8000, 'Verfügbarkeit');
      } catch (e) { return 'error'; }
    },

    async ready() {
      if (!('LanguageModel' in global)) {
        this.error = 'Dieser Browser kennt die Prompt-API nicht';
        return false;
      }
      this.audio = await this.availability(true);
      if (this.audio !== 'unavailable' && this.audio !== 'error') return true;
      this.text = await this.availability(false);
      if (this.audio === 'error') this.error = 'Die Prompt-API antwortet nicht';
      else if (this.text !== 'unavailable' && this.text !== 'error') this.error = 'Chrome kann Text, aber noch kein Audio (Multimodal-Schalter fehlt)';
      else this.error = 'Chrome hat die Prompt-API nicht freigeschaltet';
      return false;
    },

    async session() {
      return withTimeout(LanguageModel.create({
        expectedInputs: [{ type: 'audio' }],
        monitor(mon) {
          mon.addEventListener('downloadprogress', e => {
            if (!downloadCb) return;
            const pct = e && e.total
              ? Math.min(100, Math.round((e.loaded || 0) / e.total * 100))
              : (e && e.loaded != null && e.loaded <= 1 ? Math.round(e.loaded * 100) : -1);
            downloadCb('Spracherkennung wird geladen', pct);
          });
        }
      }), 900000, 'Spracherkennung laden');
    },

    async transcribe(prep) {
      const parts = slices(prep.data);
      let session = await this.session();
      const pieces = [];
      try {
        for (let i = 0; i < parts.length; i++) {
          if (i > 0 && i % 4 === 0) {                 // Sitzung frisch halten
            try { session.destroy(); } catch (e) {}
            session = await this.session();
          }
          const res = await withTimeout(session.prompt([{
            role: 'user',
            content: [{ type: 'text', value: PROMPT }, { type: 'audio', value: parts[i] }]
          }]), 300000, 'Transkription');
          const piece = cleanup(res);
          if (piece) pieces.push(piece);
        }
      } finally {
        try { session.destroy(); } catch (e) {}
      }
      return pieces.join(' ').replace(/\s{2,}/g, ' ').trim();
    }
  };

  /* ------------------------------------------------------------------ *
   * Verfügbarkeit
   * ------------------------------------------------------------------ */
  const status = { state: 'unknown', detail: '', hint: '', checking: false };

  async function check(force) {
    if (status.state === 'ready' && !force) return true;
    status.checking = true;
    status.hint = '';
    try {
      if (settings.engine === 'prompt') {
        if (await promptApi.ready()) {
          status.state = 'ready';
          status.detail = promptApi.audio === 'available'
            ? 'Chrome-Spracherkennung, on-device'
            : 'Bereit – Chrome lädt das Modell beim ersten Mal einmalig';
        } else {
          status.state = 'no';
          status.detail = promptApi.error;
          status.hint = FLAGS_HINT;
        }
      } else {
        if (await whisper.ready()) {
          status.state = 'ready';
          status.detail = 'Mitgeliefertes Modell (' + (MODELLE[settings.model] || settings.model) + ')';
        } else {
          status.state = 'no';
          status.detail = whisper.error || 'Mitgeliefertes Modell nicht verfügbar';
          status.hint = 'Der Ordner modelle/' + settings.model + ' muss neben index.html liegen. ' +
            'Außerdem muss die Seite über die Startdatei laufen (http://localhost…), ' +
            'nicht per Doppelklick auf index.html.';
        }
      }
      return status.state === 'ready';
    } finally {
      status.checking = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Eine Nachricht transkribieren
   * ------------------------------------------------------------------ */
  async function transcribeMessage(m, conv) {
    if (!isVoice(m)) return null;
    const existing = get(m.key);
    if (existing) return existing;
    if (!await check()) throw new Error(status.detail);

    const t0 = Date.now();
    const sprache = settings.engine === 'prompt' ? null : await guessLanguage(conv, m);
    const prep = await prepare(await audioBlob(m));
    const engine = settings.engine === 'prompt' ? promptApi : whisper;
    const text = await engine.transcribe(prep, sprache);

    const entry = {
      t: text,
      ms: Math.round(prep.duration * 1000),
      e: settings.engine,
      l: sprache || '',
      took: Date.now() - t0
    };
    put(m.key, entry);
    // Eine Übersetzung des vorherigen Transkripts passt jetzt nicht mehr
    if (!m.text && global.Translate) await Translate.clearFor([m.key]);
    return entry;
  }

  /* ------------------------------------------------------------------ *
   * Ganzen Chat abarbeiten
   * ------------------------------------------------------------------ */
  const job = { active: false, done: 0, total: 0, failed: 0, cancel: false, error: '' };

  async function transcribeConversation(conv, onUpdate) {
    if (job.active) return job;
    const list = pendingMessages(conv);
    job.active = true; job.cancel = false; job.done = 0; job.failed = 0; job.error = '';
    job.total = list.length;
    if (onUpdate) onUpdate(job);

    if (!await check()) {
      job.active = false; job.error = status.detail;
      if (onUpdate) onUpdate(job);
      return job;
    }

    for (const m of list) {
      if (job.cancel) break;
      try {
        await transcribeMessage(m, conv);
      } catch (e) {
        job.failed++;
        if (!job.error) job.error = e.message || String(e);
        if (job.failed >= 3 && job.done === 0) job.cancel = true;
      }
      job.done++;
      if (onUpdate) onUpdate(job);
    }

    await flush();
    job.active = false;
    if (onUpdate) onUpdate(job);
    return job;
  }

  function cancel() { job.cancel = true; }

  global.Transcribe = {
    MODELLE: MODELLE, SPRACHEN: SPRACHEN, HAEUFIG: HAEUFIG, whisperSprache: whisperSprache,
    installedModels: installedModels, settings: settings, saveSettings: saveSettings,
    load: load, get: get, text: text, flush: flush, clearFor: clearFor, clearAll: clearAll,
    isVoice: isVoice, pendingMessages: pendingMessages, audioSource: audioSource,
    check: check, status: status, onDownloadProgress: onDownloadProgress, modelBytes: modelBytes,
    transcribeMessage: transcribeMessage, transcribeConversation: transcribeConversation,
    cancel: cancel, job: job, whisper: whisper, promptApi: promptApi, prepare: prepare,
    guessLanguage: guessLanguage, forgetLanguages: () => Translate.forgetLanguages()
  };
})(window);
