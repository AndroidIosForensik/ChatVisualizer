/* Robuster CSV-Parser (RFC4180 + Auto-Delimiter, BOM, CRLF, mehrzeilige Felder) */
(function (global) {
  'use strict';

  function detectDelimiter(sample) {
    const candidates = [',', ';', '\t', '|'];
    let best = ',', bestScore = -1;
    for (const d of candidates) {
      // Anzahl Trenner in der ersten (nicht leeren) Zeile ausserhalb von Quotes
      let inQ = false, count = 0;
      for (let i = 0; i < sample.length; i++) {
        const c = sample[i];
        if (c === '"') { inQ = !inQ; continue; }
        if (!inQ && c === '\n') break;
        if (!inQ && c === d) count++;
      }
      if (count > bestScore) { bestScore = count; best = d; }
    }
    return best;
  }

  function parse(text, delimiter) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    text = text.replace(/\r\n?/g, '\n');
    const d = delimiter || detectDelimiter(text);

    const rows = [];
    let row = [], field = '', inQ = false, i = 0;
    const n = text.length;

    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQ = true; i++; continue; }
      if (c === d) { row.push(field); field = ''; i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    // Leere Zeilen entfernen
    return {
      delimiter: d,
      rows: rows.filter(r => r.length > 1 || (r[0] !== undefined && r[0].trim() !== ''))
    };
  }

  function toObjects(text) {
    const { rows, delimiter } = parse(text);
    if (!rows.length) return { header: [], data: [], delimiter };
    // Doppelte Spaltennamen (typisch für SQL-JOINs: id, name …) durchnummerieren –
    // sonst überschriebe die letzte Spalte die erste und z. B. die Nachrichten-ID
    // würde zur ID einer verknüpften Tabelle.
    const gesehen = new Map();
    const header = rows[0].map(h => {
      const name = h.trim().toLowerCase().replace(/^﻿/, '');
      const n = (gesehen.get(name) || 0) + 1;
      gesehen.set(name, n);
      return n === 1 ? name : name + ' (' + n + ')';
    });
    const data = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const obj = {};
      for (let c = 0; c < header.length; c++) {
        obj[header[c]] = (cells[c] !== undefined ? cells[c] : '').trim();
      }
      data.push(obj);
    }
    return { header, data, delimiter };
  }

  global.CSV = { parse, toObjects, detectDelimiter };
})(window);
