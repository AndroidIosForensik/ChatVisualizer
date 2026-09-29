// Ausführen: node --test tests/emoji.test.cjs (keine Installation nötig).
// Reaktionen, die als Kurzname exportiert wurden, erscheinen als Emoji.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function emoji() {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  for (const file of ['daten/emoji-namen', 'daten/emoji']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), ctx);
  }
  return ctx.Emoji;
}

test('Kurznamen in allen üblichen Schreibweisen', () => {
  const E = emoji();
  assert.equal(E.reaktion('(purple_heart)'), '💜');
  assert.equal(E.reaktion(':purple_heart:'), '💜');
  assert.equal(E.reaktion('purple heart'), '💜');
  assert.equal(E.reaktion('Purple Heart'), '💜');
  assert.equal(E.reaktion('(joy)'), '😂');
  assert.equal(E.reaktion(':+1:'), '👍');
  assert.equal(E.reaktion('thumbs up'), '👍');
  assert.equal(E.reaktion('face with tears of joy'), '😂');
});

test('Hautfarben, Teams/Skype/Facebook-Namen, echte Emoji und Unbekanntes', () => {
  const E = emoji();
  assert.equal(E.reaktion(':+1::skin-tone-3:'), '👍\u{1F3FC}');
  assert.equal(E.reaktion('(thumbsup_tone4)'), '👍\u{1F3FE}');
  assert.equal(E.reaktion('(like)'), '👍');
  assert.equal(E.reaktion('(heart)'), '❤️');
  assert.equal(E.reaktion('Haha'), '😆');
  assert.equal(E.reaktion('😂'), '😂');                 // schon Emoji: unverändert
  assert.equal(E.reaktion('(gibtsnicht)'), '(gibtsnicht)');
  assert.equal(E.reaktion(''), '❤️');                  // leere Reaktion wie bisher
  assert.equal(E.ausName('Das war super, danke dir!'), null);
});
