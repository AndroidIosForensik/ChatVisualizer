/* Kleiner ZIP-Leser für Office-Dateien (docx, xlsx, pptx, odt …).
   Entpackt wird mit der eingebauten DecompressionStream des Browsers –
   keine zusätzliche Bibliothek nötig. */
(function (global) {
  'use strict';

  const EOCD = 0x06054b50;          // Ende des zentralen Verzeichnisses
  const EOCD64_LOC = 0x07064b50;    // Zip64-Verweis
  const CEN = 0x02014b50;           // Eintrag im zentralen Verzeichnis

  function dv(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }

  /* Verzeichnis am Dateiende suchen (hinten stehen bis zu 64 KB Kommentar) */
  function findEOCD(bytes) {
    const d = dv(bytes);
    const min = Math.max(0, bytes.length - 66000);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (d.getUint32(i, true) === EOCD) return i;
    }
    return -1;
  }

  function list(bytes) {
    const d = dv(bytes);
    const eocd = findEOCD(bytes);
    if (eocd < 0) throw new Error('Keine ZIP-Datei');

    let anzahl = d.getUint16(eocd + 10, true);
    let start = d.getUint32(eocd + 16, true);

    // Zip64, falls die Felder übergelaufen sind
    if (start === 0xffffffff || anzahl === 0xffff) {
      for (let i = eocd - 20; i >= 0; i--) {
        if (d.getUint32(i, true) === EOCD64_LOC) {
          const off64 = Number(d.getBigUint64(i + 8, true));
          anzahl = Number(d.getBigUint64(off64 + 32, true));
          start = Number(d.getBigUint64(off64 + 48, true));
          break;
        }
      }
    }

    const dec = new TextDecoder('utf-8');
    const eintraege = [];
    let p = start;
    for (let i = 0; i < anzahl && p + 46 <= bytes.length; i++) {
      if (d.getUint32(p, true) !== CEN) break;
      const methode = d.getUint16(p + 10, true);
      const packedSize = d.getUint32(p + 20, true);
      const size = d.getUint32(p + 24, true);
      const nameLen = d.getUint16(p + 28, true);
      const extraLen = d.getUint16(p + 30, true);
      const kommLen = d.getUint16(p + 32, true);
      const lokal = d.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      eintraege.push({ name: name, methode: methode, packedSize: packedSize, size: size, lokal: lokal });
      p += 46 + nameLen + extraLen + kommLen;
    }
    return eintraege;
  }

  async function inflate(roh) {
    if (!global.DecompressionStream) throw new Error('Dieser Browser kann ZIP nicht entpacken');
    const stream = new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* Inhalt eines Eintrags holen */
  async function read(bytes, eintrag) {
    const d = dv(bytes);
    const p = eintrag.lokal;
    if (d.getUint32(p, true) !== 0x04034b50) throw new Error('Beschädigter ZIP-Eintrag');
    const nameLen = d.getUint16(p + 26, true);
    const extraLen = d.getUint16(p + 28, true);
    const start = p + 30 + nameLen + extraLen;
    const roh = bytes.subarray(start, start + (eintrag.packedSize || (bytes.length - start)));
    if (eintrag.methode === 0) return roh.slice();
    if (eintrag.methode === 8) return inflate(roh);
    throw new Error('Unbekanntes Packverfahren (' + eintrag.methode + ')');
  }

  /* Bequem: alle Einträge lesen, deren Name passt */
  async function readMatching(bytes, test) {
    const treffer = list(bytes).filter(e => !e.name.endsWith('/') && test(e.name));
    const out = [];
    for (const e of treffer) {
      try { out.push({ name: e.name, daten: await read(bytes, e) }); }
      catch (err) { /* einzelne kaputte Einträge überspringen */ }
    }
    return out;
  }

  global.Archive = { list: list, read: read, readMatching: readMatching };
})(window);
