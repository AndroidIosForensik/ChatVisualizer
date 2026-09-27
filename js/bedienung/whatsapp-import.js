/* Einstellungen eines Textexports und lokale ZIP-Anhänge. */
(function (global) {
  'use strict';
  const $ = Helfer.$;
  const MAX_ZIP = 512 * 1024 * 1024;
  const MAX_TEXT = 32 * 1024 * 1024;

  function configure(info, path, suggestedName) {
    const dialog = $('#whatsappDialog');
    $('#waImportFile').textContent = path + ' · ' + info.records.length + ' Nachrichten';
    $('#waImportName').value = suggestedName || WhatsApp.chatName(path);
    $('#waImportOrder').value = info.dateOrder;
    $('#waImportDate').textContent = 'Erster Zeitstempel: ' + info.records[0].date + ' ' + info.records[0].time +
      (info.ambiguous ? ' – Tag und Monat sind nicht eindeutig. Bitte auswählen.' : ' – Format automatisch erkannt.');
    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => {
        resolve(dialog.returnValue === 'import' ? {
          name: $('#waImportName').value.trim(), dateOrder: $('#waImportOrder').value
        } : null);
      }, { once: true });
      dialog.showModal();
    });
  }

  async function unzip(file) {
    if (file.size > MAX_ZIP) throw new Error('ZIP ist größer als 512 MB. Bitte entpacken und den Exportordner verbinden.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const list = Archive.list(bytes).filter(e => !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/'));
    if (list.length > 50000 || list.reduce((n, e) => n + e.size, 0) > 1024 * 1024 * 1024) {
      throw new Error('ZIP enthält zu viele oder zu große Dateien. Bitte entpacken und den Exportordner verbinden.');
    }
    const prefix = 'whatsapp-zip/' + WhatsApp.fingerprint(JSON.stringify(
      [file.name, list.map(e => [e.name, e.size, e.crc])]
    ));
    const sources = [], chats = [];
    for (const entry of list) {
      const relative = entry.name.replace(/\\/g, '/');
      if (/^(?:\/|[a-z]:)/i.test(relative) || relative.split('/').some(p => p === '..' || p === '.')) {
        throw new Error('Ungültiger Pfad im ZIP: ' + entry.name);
      }
      const path = prefix + '/' + relative;
      const name = relative.split('/').pop();
      const getFile = async () => new File([await Archive.read(bytes, entry)], name,
        { type: Media.mimeType(name) || 'application/octet-stream' });
      sources.push({ path, handle: { getFile }, size: entry.size });
      if (/\.txt$/i.test(name)) {
        const text = new TextDecoder('utf-8').decode(await Archive.read(bytes, entry, MAX_TEXT));
        const info = WhatsApp.inspect(text);
        if (info) chats.push({ file: new File([text], name, { type: 'text/plain' }), path, info,
          displayPath: file.name + ' / ' + relative,
          suggestedName: WhatsApp.chatName(relative.includes('/') ? relative :
            (/^_?chat\.txt$/i.test(name) ? file.name : name)) });
      }
    }
    if (!chats.length) throw new Error('Kein unterstützter WhatsApp-Textexport im ZIP gefunden.');
    return { chats, sources, label: file.name };
  }

  global.WhatsAppImport = { configure, unzip };
})(window);
