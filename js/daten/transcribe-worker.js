/* Spracherkennung im eigenen Thread: Whisper über transformers.js (ONNX).
   Alle Dateien liegen im Projektordner, es wird nichts aus dem Netz geladen.

   Achtung: Pfade hier sind relativ zu dieser Datei (js/daten/), nicht zur
   Seite – deshalb zwei Ebenen hinauf in den Projektordner. */

import { pipeline, env } from '../../vendor/transformers/transformers.min.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('../../modelle/', self.location.href).href;
env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/transformers/', self.location.href).href;
/* Ein Thread: die Mehrkern-Variante der ONNX-Laufzeit bleibt im Arbeiter-Thread haengen. */
env.backends.onnx.wasm.numThreads = 1;

let current = null;      // { name, pipe }

function post(msg) { self.postMessage(msg); }

function getPipe(name) {
  if (current && current.name === name) return current.pipe;
  post({ type: 'loading', model: name });

  /* transformers.js meldet den Fortschritt je Datei. Für eine sinnvolle Anzeige
     werden die geladenen Bytes über alle Dateien aufsummiert. */
  const geladen = new Map();
  const melde = () => {
    let summe = 0;
    for (const v of geladen.values()) summe += v;
    post({ type: 'progress', model: name, bytes: summe });
  };

  const pipe = pipeline('automatic-speech-recognition', name, {
    dtype: 'q8',
    progress_callback: info => {
      if (!info || !info.file) return;
      if (info.status === 'progress' && info.loaded != null) {
        geladen.set(info.file, info.loaded);
        melde();
      } else if (info.status === 'done') {
        if (info.total != null) geladen.set(info.file, info.total);
        melde();
      }
    }
  });
  pipe.catch(() => { if (current && current.name === name) current = null; });
  current = { name: name, pipe: pipe };
  return pipe;
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};

  if (msg.type === 'ping') {
    post({ type: 'pong', id: msg.id });
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      const pipe = await getPipe(msg.model);
      const opts = {
        chunk_length_s: 30,        // Whisper zerlegt lange Aufnahmen selbst
        stride_length_s: 5,        // Überlappung, damit an den Nähten nichts verloren geht
        return_timestamps: false,
        task: 'transcribe'
      };
      if (msg.language) opts.language = msg.language;   // sonst erkennt Whisper die Sprache selbst
      const out = await pipe(msg.audio, opts);
      const text = (Array.isArray(out) ? out[0] : out || {}).text || '';
      post({ type: 'result', id: msg.id, ok: true, text: String(text).trim() });
    } catch (e) {
      post({ type: 'result', id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  }
};

post({ type: 'ready' });
