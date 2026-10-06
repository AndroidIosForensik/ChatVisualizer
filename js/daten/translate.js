/* Übersetzung über die eingebaute Übersetzung von Chrome/Edge (Translator-API).
   Läuft on-device: der Browser lädt einmal ein Sprachpaket, danach verlässt kein
   Text den Rechner. Ergebnisse werden lokal gespeichert. */
(function (global) {
  'use strict';

  const LANGS = {
    de: 'Deutsch', en: 'Englisch', fr: 'Französisch', es: 'Spanisch', it: 'Italienisch',
    nl: 'Niederländisch', pt: 'Portugiesisch', pl: 'Polnisch', ru: 'Russisch', uk: 'Ukrainisch',
    tr: 'Türkisch', ar: 'Arabisch', ro: 'Rumänisch', cs: 'Tschechisch', hu: 'Ungarisch',
    sv: 'Schwedisch', da: 'Dänisch', no: 'Norwegisch', fi: 'Finnisch', el: 'Griechisch',
    zh: 'Chinesisch', ja: 'Japanisch', ko: 'Koreanisch', hi: 'Hindi', fa: 'Persisch',
    he: 'Hebräisch', vi: 'Vietnamesisch', th: 'Thai', id: 'Indonesisch', sr: 'Serbisch',
    hr: 'Kroatisch', bg: 'Bulgarisch', sq: 'Albanisch', sk: 'Slowakisch', sl: 'Slowenisch',
    lt: 'Litauisch', bn: 'Bengalisch', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', kn: 'Kannada',
    'zh-Hant': 'Chinesisch (traditionell)'
  };

  const settings = {
    target:     Store.settings.get('trTarget', 'de'),
    skipTarget: Store.settings.get('trSkipTarget', true)
  };

  /* Ausgangssprache je Chat: convKey → Sprachcode. Fehlt der Eintrag,
     wird die Sprache jeder Nachricht erkannt („automatisch"). */
  const quellen = Store.settings.get('trSourceByConv', {}) || {};

  function saveSettings() {
    Store.settings.set('trTarget', settings.target);
    Store.settings.set('trSkipTarget', settings.skipTarget);
    Store.settings.set('trSourceByConv', quellen);
  }

  /** Fest gewählte Ausgangssprache eines Chats, '' = automatisch erkennen. */
  function sourceFor(convKey) {
    return (convKey && quellen[convKey]) || '';
  }

  function setSource(convKey, code) {
    if (!convKey) return;
    if (code) quellen[convKey] = code; else delete quellen[convKey];
    saveSettings();
  }

  /** Sprachname für Meldungen (Code, wenn unbekannt). */
  function sprachName(code) {
    return LANGS[code] || (code ? code.toUpperCase() : '');
  }

  /* ------------------------------------------------------------------ *
   * Zwischenspeicher
   * ------------------------------------------------------------------ */
  const cache = new Map();        // msgKey|lang -> { t, s, b }
  let pending = [];               // noch nicht gespeicherte Einträge
  let saveTimer = null;

  function ck(msgKey) { return msgKey + '|' + settings.target; }

  function get(msgKey) { return cache.get(ck(msgKey)) || null; }

  function put(msgKey, entry) {
    const key = ck(msgKey);
    cache.set(key, entry);
    pending.push({ key: key, msgKey: msgKey, lang: settings.target, t: entry.t, s: entry.s, b: entry.b });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  }

  async function flush() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    await Store.putTranslations(batch);
  }

  async function load() {
    const rows = await Store.getTranslations();
    for (const r of rows) cache.set(r.key, { t: r.t, s: r.s, b: r.b });
    return cache.size;
  }

  async function clearFor(msgKeys) {
    const keys = msgKeys.map(ck);
    for (const k of keys) cache.delete(k);
    await Store.deleteTranslations(keys);
  }

  async function clearAll() {
    cache.clear();
    pending = [];
    await Store.clearTranslations();
  }

  /* ------------------------------------------------------------------ *
   * Hilfsmittel
   * ------------------------------------------------------------------ */
  /* Zeitlimit für hängende Browser-Schnittstellen – siehe kern/helfer.js */
  const withTimeout = Helfer.withTimeout;

  /* Quelle einer Nachricht: der Text – oder bei Sprachnachrichten das Transkript */
  function sourceText(m) {
    if (!m) return '';
    if (m.text) return m.text;
    if (global.Transcribe) return Transcribe.text(m.key) || '';
    return '';
  }

  /* Nachrichten ohne Buchstaben (nur Emoji, Zahlen, Links) braucht niemand zu übersetzen */
  function translatable(text) {
    if (!text) return false;
    const stripped = String(text)
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu, ' ');
    return /\p{L}{2,}/u.test(stripped);
  }

  /* ------------------------------------------------------------------ *
   * Spracherkennung
   * ------------------------------------------------------------------ */
  let detectorPromise = null;

  async function getDetector() {
    if (!('LanguageDetector' in global)) return null;
    if (!detectorPromise) {
      detectorPromise = (async () => {
        const avail = await withTimeout(LanguageDetector.availability(), 6000, 'Spracherkennung');
        if (avail === 'unavailable') return null;
        return withTimeout(LanguageDetector.create(), 120000, 'Spracherkennung laden');
      })().catch(() => null);
    }
    return detectorPromise;
  }

  /* Ersatzerkennung, falls der Browser keine Spracherkennung mitbringt */
  const STOPWORDS = {
    de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'du', 'wir', 'auch', 'mit', 'für', 'noch', 'schon', 'aber', 'sehr', 'kann', 'dass', 'heute', 'morgen'],
    en: ['the', 'and', 'is', 'not', 'you', 'we', 'with', 'for', 'this', 'that', 'have', 'are', 'just', 'what', 'about', 'would', 'there', 'today', 'thanks'],
    fr: ['le', 'la', 'les', 'et', 'est', 'pas', 'je', 'tu', 'nous', 'avec', 'pour', 'que', 'dans', 'mais', 'bien', 'merci', 'demain'],
    es: ['el', 'la', 'los', 'que', 'no', 'de', 'por', 'para', 'con', 'una', 'pero', 'muy', 'gracias', 'mañana', 'hola'],
    it: ['il', 'la', 'che', 'non', 'per', 'con', 'una', 'sono', 'anche', 'grazie', 'domani', 'ciao'],
    nl: ['de', 'het', 'een', 'niet', 'en', 'je', 'van', 'voor', 'met', 'ook', 'maar', 'bedankt'],
    pt: ['que', 'não', 'uma', 'para', 'com', 'mais', 'como', 'obrigado', 'você', 'amanhã'],
    pl: ['nie', 'jest', 'się', 'jak', 'tak', 'ale', 'dla', 'czy', 'dzięki', 'jutro'],
    tr: ['bir', 've', 'için', 'ama', 'çok', 'ben', 'sen', 'değil', 'teşekkür', 'yarın']
  };

  function heuristicDetect(text) {
    const s = String(text || '');
    if (/[Ѐ-ӿ]/.test(s)) return 'ru';
    if (/[؀-ۿ]/.test(s)) return 'ar';
    if (/[֐-׿]/.test(s)) return 'he';
    if (/[぀-ヿ]/.test(s)) return 'ja';
    if (/[가-힯]/.test(s)) return 'ko';
    if (/[一-鿿]/.test(s)) return 'zh';
    if (/[Ͱ-Ͽ]/.test(s)) return 'el';

    const words = s.toLowerCase().match(/\p{L}+/gu) || [];
    if (!words.length) return null;
    const set = new Set(words);
    let best = null, bestScore = 0;
    for (const lang of Object.keys(STOPWORDS)) {
      let score = 0;
      for (const w of STOPWORDS[lang]) if (set.has(w)) score++;
      if (lang === 'de' && /[äöüß]/.test(s)) score += 1.5;
      if (lang === 'tr' && /[şğıçö]/.test(s)) score += 1.5;
      if (lang === 'es' && /[¿¡ñ]/.test(s)) score += 1.5;
      if (lang === 'fr' && /[àèéêçô]/.test(s)) score += 1;
      if (score > bestScore) { bestScore = score; best = lang; }
    }
    return bestScore >= 1 ? best : null;
  }

  async function detect(text) {
    const det = await getDetector();
    if (det) {
      try {
        const res = await withTimeout(det.detect(text), 8000, 'Spracherkennung');
        const top = res && res[0];
        if (top && top.confidence >= 0.35 && top.detectedLanguage !== 'und') {
          return top.detectedLanguage.split('-')[0];
        }
      } catch (e) { /* Ersatzerkennung nutzen */ }
    }
    return heuristicDetect(text);
  }

  /* Vorherrschende Sprache einer Unterhaltung – Rückfall, wenn die Erkennung
     an einer einzelnen (kurzen) Nachricht scheitert. Wird auch von der
     Transkription genutzt, die für Whisper zwingend eine Sprache braucht. */
  const convLang = new Map();

  async function conversationLanguage(conv, m) {
    if (!conv) return null;
    if (convLang.has(conv.key)) return convLang.get(conv.key);

    const texte = conv.messages.filter(x => x.text && x.type !== 'system' && translatable(x.text));
    const eigene = m ? texte.filter(x => x.sender === m.sender) : [];
    const probe = (eigene.length >= 3 ? eigene : texte).slice(-12);

    const zaehler = new Map();
    for (const p of probe) {
      const code = p.lang || await detect(p.text);
      if (code) { p.lang = code; zaehler.set(code, (zaehler.get(code) || 0) + 1); }
    }
    let best = null, bestN = 0;
    for (const [c, n] of zaehler) if (n > bestN) { best = c; bestN = n; }
    convLang.set(conv.key, best);
    return best;
  }

  /* ------------------------------------------------------------------ *
   * Eingebaute Übersetzung des Browsers
   * ------------------------------------------------------------------ */
  let downloadCb = null;
  function onDownloadProgress(cb) { downloadCb = cb; }

  /* Chrome meldet den Ladefortschritt als Anteil (0…1); zur Sicherheit auch
     Bytes-Angaben verarbeiten, sonst stünde dort eine unsinnige Prozentzahl. */
  function ladeProzent(e) {
    if (!e) return -1;
    if (e.total) return Math.min(100, Math.round((e.loaded || 0) / e.total * 100));
    if (e.loaded != null && e.loaded <= 1) return Math.round(e.loaded * 100);
    return -1;
  }


  const builtin = {
    pairs: new Map(),
    blocked: false,

    supported() { return 'Translator' in global && !this.blocked; },

    /** Bietet der Browser das Sprachpaar an? Ohne feste Quelle wird en → Ziel geprüft. */
    async ready(src) {
      if (!this.supported()) return false;
      const quelle = src && src !== settings.target ? src : (settings.target === 'en' ? 'de' : 'en');
      try {
        // Der erste Aufruf nach dem Browserstart braucht mitunter deutlich länger
        const a = await withTimeout(
          Translator.availability({ sourceLanguage: quelle, targetLanguage: settings.target }),
          15000, 'Verfügbarkeit');
        return a !== 'unavailable';
      } catch (e) {
        this.blocked = true;     // API vorhanden, antwortet aber nicht
        return false;
      }
    },

    async instance(src, tgt) {
      const k = src + '>' + tgt;
      if (this.pairs.has(k)) return this.pairs.get(k);
      const p = (async () => {
        const avail = await withTimeout(
          Translator.availability({ sourceLanguage: src, targetLanguage: tgt }), 8000, 'Verfügbarkeit');
        if (avail === 'unavailable') throw new Error('Sprachpaar ' + src + ' → ' + tgt + ' wird nicht angeboten');
        const label = 'Sprachpaket ' + src + ' → ' + tgt + ' wird geladen';
        if (avail !== 'available' && downloadCb) downloadCb(label, 0);
        const inst = await withTimeout(Translator.create({
          sourceLanguage: src,
          targetLanguage: tgt,
          monitor(mon) {
            mon.addEventListener('downloadprogress', e => {
              if (downloadCb) downloadCb(label, ladeProzent(e));
            });
          }
        }), 600000, 'Sprachpaket laden');
        if (downloadCb) downloadCb(label, 100);
        return inst;
      })();
      this.pairs.set(k, p);
      p.catch(() => this.pairs.delete(k));
      return p;
    },

    async translate(text, src, tgt) {
      const t = await this.instance(src, tgt);
      return withTimeout(t.translate(text), 60000, 'Übersetzung');
    }
  };

  /* ------------------------------------------------------------------ *
   * Verfügbarkeit
   * ------------------------------------------------------------------ */
  const status = { ok: false, detail: '', checking: false, paar: '' };

  /**
   * Ist die Übersetzung einsatzbereit – für die feste Ausgangssprache src,
   * falls gewählt? Das Ergebnis gilt je Sprachpaar.
   */
  async function check(force, src) {
    const paar = (src || 'auto') + '>' + settings.target;
    if (status.ok && !force && status.paar === paar) return true;
    // Eine frühere Zeitüberschreitung sperrt nicht für immer: neu prüfen erlaubt neuen Versuch
    if (force) builtin.blocked = false;
    status.checking = true;
    status.paar = paar;
    try {
      if (!('Translator' in global)) {
        status.ok = false;
        status.detail = 'Dieser Browser übersetzt nicht selbst – Chrome oder Edge ab Version 138 nutzen';
      } else if (await builtin.ready(src)) {
        status.ok = true;
        status.detail = 'Browser-Übersetzung, on-device';
      } else {
        status.ok = false;
        status.detail = builtin.blocked
          ? 'Die Übersetzung des Browsers antwortet nicht'
          : src
            ? 'Das Sprachpaar ' + sprachName(src) + ' → ' + sprachName(settings.target) + ' bietet der Browser nicht an'
            : 'Diese Zielsprache bietet der Browser nicht an';
      }
    } finally {
      status.checking = false;
    }
    return status.ok;
  }

  /**
   * Sprachpaket gleich beim Klick anfordern. Chrome lädt ein fehlendes Paket nur
   * kurz nach einer Nutzeraktion; läuft vorher die Spracherkennung, ist dieses
   * Zeitfenster oft schon vorbei. Deshalb aus dem Klick heraus aufrufen.
   */
  function vorbereiten(conv) {
    if (!('Translator' in global) || !conv) return;
    const src = sourceFor(conv.key) || convLang.get(conv.key);
    if (src && src !== settings.target) builtin.instance(src, settings.target).catch(() => {});
  }

  /* Chrome verweigert das Laden eines Sprachpakets ohne vorherigen Klick */
  function klarerFehler(e) {
    if (e && e.name === 'NotAllowedError') {
      return new Error('Das Sprachpaket muss per Klick geladen werden – bitte noch einmal auf 🌐 klicken');
    }
    return e;
  }

  /* ------------------------------------------------------------------ *
   * Einzelne Nachricht übersetzen
   * ------------------------------------------------------------------ */
  async function translateMessage(m, conv) {
    const source = sourceText(m);
    if (!translatable(source)) return null;
    const existing = get(m.key);
    if (existing) return existing;

    const fest = sourceFor(conv && conv.key);
    if (!await check(false, fest)) throw new Error(status.detail);

    // Erkannt wird auch bei fester Ausgangssprache, sofern Nachrichten in der
    // Zielsprache übersprungen werden sollen (etwa eigene Antworten im Chat).
    let erkannt = null;
    if (!fest || settings.skipTarget) {
      erkannt = m.lang || await detect(source);
      if (erkannt) m.lang = erkannt;
    }
    const src = fest || erkannt || await conversationLanguage(conv, m);

    // Schon in der Zielsprache: nichts zu tun (gleiche Sprache kann der Browser nicht)
    if (src === settings.target || (settings.skipTarget && erkannt === settings.target)) {
      const entry = { t: null, s: erkannt || src, b: 'skip' };
      put(m.key, entry);
      return entry;
    }
    if (!src) throw new Error('Sprache nicht erkannt – Ausgangssprache im Panel (▾) fest wählen');

    let text;
    try { text = await builtin.translate(source, src, settings.target); }
    catch (e) { throw klarerFehler(e); }
    const entry = {
      t: (text && text.trim() && text.trim() !== source.trim()) ? text.trim() : null,
      s: src,
      b: 'builtin'
    };
    put(m.key, entry);
    return entry;
  }

  /* ------------------------------------------------------------------ *
   * Warteschlange für ganze Chats
   * ------------------------------------------------------------------ */
  const job = { active: false, done: 0, total: 0, failed: 0, cancel: false, error: '' };

  function pendingMessages(conv) {
    return conv.messages.filter(m => m.type !== 'system' && translatable(sourceText(m)) && !get(m.key));
  }

  async function translateConversation(conv, onUpdate) {
    if (job.active) return job;
    const list = pendingMessages(conv);
    job.active = true; job.cancel = false; job.done = 0; job.failed = 0; job.error = '';
    job.total = list.length;
    if (onUpdate) onUpdate(job);

    if (!await check(false, sourceFor(conv.key))) {
      job.active = false; job.error = status.detail;
      if (onUpdate) onUpdate(job);
      return job;
    }

    let i = 0;

    async function worker() {
      while (i < list.length && !job.cancel) {
        const m = list[i++];
        try {
          await translateMessage(m, conv);
        } catch (e) {
          job.failed++;
          if (!job.error) job.error = e.message || String(e);
          // Bei grundsätzlichen Problemen abbrechen statt hunderte Fehlversuche
          if (job.failed >= 3 && job.done === 0) job.cancel = true;
        }
        job.done++;
        if (onUpdate && (job.done % 3 === 0 || job.done === job.total)) onUpdate(job);
      }
    }

    const workers = [];
    for (let w = 0; w < 3; w++) workers.push(worker());
    await Promise.all(workers);

    await flush();
    job.active = false;
    if (onUpdate) onUpdate(job);
    return job;
  }

  function cancel() { job.cancel = true; }

  global.Translate = {
    LANGS: LANGS, settings: settings, saveSettings: saveSettings,
    sourceFor: sourceFor, setSource: setSource, sprachName: sprachName, vorbereiten: vorbereiten,
    erkannteSprache: convKey => convLang.get(convKey) || null,
    load: load, get: get, flush: flush, clearFor: clearFor, clearAll: clearAll,
    translatable: translatable, detect: detect, sourceText: sourceText,
    conversationLanguage: conversationLanguage, forgetLanguages: () => convLang.clear(),
    translateMessage: translateMessage, translateConversation: translateConversation,
    pendingMessages: pendingMessages, cancel: cancel, job: job,
    onDownloadProgress: onDownloadProgress,
    status: status, check: check, builtin: builtin
  };
})(window);
