/* Messenger-Erkennung, Farben und vereinfachte Logos (Inline-SVG) */
(function (global) {
  'use strict';

  const B = {
    whatsapp:  { label: 'WhatsApp',  color: '#25D366', glyph: 'bubble-phone' },
    threema:   { label: 'Threema',   color: '#4EBE4E', glyph: 'bubble-dots'  },
    telegram:  { label: 'Telegram',  color: '#2AABEE', glyph: 'plane'        },
    signal:    { label: 'Signal',    color: '#3A76F0', glyph: 'bubble'       },
    imessage:  { label: 'iMessage',  color: '#34C759', glyph: 'bubble'       },
    sms:       { label: 'SMS',       color: '#7A8AA8', glyph: 'envelope'     },
    instagram: { label: 'Instagram', color: '#E1306C', glyph: 'camera'       },
    messenger: { label: 'Messenger', color: '#0084FF', glyph: 'bolt-bubble'  },
    facebook:  { label: 'Facebook',  color: '#1877F2', glyph: 'bubble'       },
    snapchat:  { label: 'Snapchat',  color: '#F7C800', glyph: 'ghost'        },
    discord:   { label: 'Discord',   color: '#5865F2', glyph: 'bubble-dots'  },
    slack:     { label: 'Slack',     color: '#611F69', glyph: 'hash'         },
    teams:     { label: 'Teams',     color: '#5059C9', glyph: 'people'       },
    viber:     { label: 'Viber',     color: '#7360F2', glyph: 'bubble-phone' },
    wechat:    { label: 'WeChat',    color: '#07C160', glyph: 'bubble-dots'  },
    email:     { label: 'E-Mail',    color: '#C4544B', glyph: 'envelope'     },
    matrix:    { label: 'Matrix',    color: '#0DBD8B', glyph: 'hash'         },
    unknown:   { label: 'Unbekannt', color: '#8A93A6', glyph: 'bubble'       }
  };

  const ALIASES = {
    'whats app': 'whatsapp', 'wa': 'whatsapp', 'whatsapp business': 'whatsapp',
    'fb messenger': 'messenger', 'facebook messenger': 'messenger', 'meta messenger': 'messenger',
    'insta': 'instagram', 'ig': 'instagram',
    'apple': 'imessage', 'i message': 'imessage', 'messages': 'imessage',
    'mms': 'sms', 'text': 'sms',
    'ms teams': 'teams', 'microsoft teams': 'teams',
    'mail': 'email', 'e-mail': 'email', 'gmail': 'email', 'outlook': 'email',
    'snap': 'snapchat', 'tg': 'telegram'
  };

  function normalize(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return 'unknown';
    const clean = s.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
    if (B[clean]) return clean;
    if (ALIASES[clean]) return ALIASES[clean];
    const collapsed = clean.replace(/ /g, '');
    if (B[collapsed]) return collapsed;
    if (ALIASES[collapsed]) return ALIASES[collapsed];
    for (const key of Object.keys(B)) if (collapsed.includes(key)) return key;
    return clean; // unbekannter Messenger: eigener Eintrag mit Fallback-Darstellung
  }

  function brand(key) {
    if (B[key]) return B[key];
    // Generischer Eintrag mit deterministischer Farbe
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return {
      label: key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unbekannt',
      color: 'hsl(' + (h % 360) + ' 55% 48%)',
      glyph: 'letter:' + (key.charAt(0) || '?').toUpperCase()
    };
  }

  const GLYPHS = {
    'bubble': '<path d="M12 4c-4.4 0-8 2.9-8 6.5 0 2 1.1 3.8 2.9 5L6 19.5l3.7-1.6c.7.2 1.5.3 2.3.3 4.4 0 8-2.9 8-6.5S16.4 4 12 4z"/>',
    'bubble-dots': '<path d="M12 4c-4.4 0-8 2.9-8 6.5 0 2 1.1 3.8 2.9 5L6 19.5l3.7-1.6c.7.2 1.5.3 2.3.3 4.4 0 8-2.9 8-6.5S16.4 4 12 4z"/><circle cx="8.7" cy="10.5" r="1.05" fill="var(--glyph-bg)"/><circle cx="12" cy="10.5" r="1.05" fill="var(--glyph-bg)"/><circle cx="15.3" cy="10.5" r="1.05" fill="var(--glyph-bg)"/>',
    'bubble-phone': '<path d="M12 3.6c-4.7 0-8.5 3.2-8.5 7.1 0 1.6.6 3.1 1.7 4.3l-1 3.6 3.8-1.5c1.2.5 2.6.8 4 .8 4.7 0 8.5-3.2 8.5-7.1S16.7 3.6 12 3.6z"/><path d="M9.6 8.4c.2-.4.5-.4.8-.4h.5c.2 0 .4 0 .5.4l.6 1.4c.1.3 0 .5-.1.6l-.4.4c-.1.1-.2.3-.1.5.3.6 1 1.4 1.8 1.7.2.1.4 0 .5-.1l.4-.5c.2-.2.4-.2.6-.1l1.4.7c.3.1.4.3.4.5 0 .6-.4 1.3-.7 1.5-.3.2-.7.4-1.2.3-1.3-.2-2.6-1-3.6-2s-1.8-2.2-2-3.3c-.1-.5 0-1 .3-1.3z" fill="var(--glyph-bg)"/>',
    'plane': '<path d="M20.7 4.3 3.6 10.9c-.7.3-.7 1.2 0 1.4l4.2 1.4 1.6 4.8c.2.6 1 .8 1.4.2l2.2-2.7 4.3 3.2c.5.4 1.2.1 1.3-.5l2.8-13.2c.2-.8-.7-1.4-1.7-1.2z"/>',
    'envelope': '<path d="M3.5 6.5h17a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M3.2 7.6 12 13l8.8-5.4" fill="none" stroke="var(--glyph-bg)" stroke-width="1.4"/>',
    'camera': '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4.1" fill="none" stroke="var(--glyph-bg)" stroke-width="1.6"/><circle cx="17" cy="7" r="1.2" fill="var(--glyph-bg)"/>',
    'bolt-bubble': '<path d="M12 3.5c-4.8 0-8.6 3.5-8.6 7.9 0 2.4 1.2 4.6 3.1 6v3.1l2.9-1.6c.8.2 1.7.3 2.6.3 4.8 0 8.6-3.5 8.6-7.8S16.8 3.5 12 3.5z"/><path d="m7.6 13.6 3-3.2 1.8 1.8 2.9-1.9-3 3.2-1.8-1.8z" fill="var(--glyph-bg)"/>',
    'ghost': '<path d="M12 3.4c-3.3 0-5.6 2.3-5.6 5.5 0 1.6-.3 2.6-1.3 3.4-.6.5-.4 1.2.4 1.4l1 .2c-.2.9-.9 1.4-1.7 1.7-.7.2-.6 1 .1 1.2 1.2.3 2.3.3 3.1.6.6.2.9.6 1.3 1 .6.6 1.4 1 2.7 1s2.1-.4 2.7-1c.4-.4.7-.8 1.3-1 .8-.3 1.9-.3 3.1-.6.7-.2.8-1 .1-1.2-.8-.3-1.5-.8-1.7-1.7l1-.2c.8-.2 1-.9.4-1.4-1-.8-1.3-1.8-1.3-3.4 0-3.2-2.3-5.5-5.6-5.5z"/>',
    'hash': '<path d="M9.4 4h2l-.6 4h3l.6-4h2l-.6 4H19v2h-3.5l-.5 4H19v2h-4.3l-.6 4h-2l.6-4h-3l-.6 4h-2l.6-4H5v-2h3.5l.5-4H5V8h4.3zm1.1 6-.5 4h3l.5-4z"/>',
    'people': '<circle cx="9" cy="8.5" r="3.2"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5z"/><path d="M15.4 14.2c2.6 0 5.1 1.5 5.1 4.8h-4.3c0-1.9-.5-3.5-1.4-4.7z"/>'
  };

  function iconSVG(key, size) {
    const b = brand(key);
    const s = size || 22;
    let inner;
    if (b.glyph.startsWith('letter:')) {
      inner = '<text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="700" font-family="system-ui,sans-serif" fill="#fff">' + b.glyph.slice(7) + '</text>';
      return '<svg class="msg-logo" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true">' +
        '<rect width="24" height="24" rx="7" fill="' + b.color + '"/>' + inner + '</svg>';
    }
    inner = GLYPHS[b.glyph] || GLYPHS.bubble;
    return '<svg class="msg-logo" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true" style="--glyph-bg:' + b.color + '">' +
      '<rect width="24" height="24" rx="7" fill="' + b.color + '"/>' +
      '<g fill="#fff" transform="translate(12 12) scale(.82) translate(-12 -12)">' + inner + '</g></svg>';
  }

  global.Messengers = { normalize, brand, iconSVG, known: B };
})(window);
