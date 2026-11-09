import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStickerPath, MAX_STICKER_BYTES, stickerFolder, stickerName, stickerPath, validateStickerFile } from './stickers.ts';

const C = '123e4567-e89b-12d3-a456-426614174000';
const OUTRA = '123e4567-e89b-12d3-a456-426614174999';
const ID = '223e4567-e89b-12d3-a456-426614174000';

test('figurinha: caminho na pasta da empresa', () => {
  assert.equal(stickerFolder(C), `${C}/stickers/`);
  assert.equal(stickerPath(C, ID), `${C}/stickers/${ID}.webp`);
  assert.equal(isStickerPath(C, stickerPath(C, ID)), true);
  // outra empresa, outra pasta, subida de diretório e lixo não valem
  assert.equal(isStickerPath(C, stickerPath(OUTRA, ID)), false);
  assert.equal(isStickerPath(C, `${C}/${ID}/arquivo.webp`), false);
  assert.equal(isStickerPath(C, `${C}/stickers/../${ID}/a.webp`), false);
  assert.equal(isStickerPath(C, `${C}/stickers/a/b.webp`), false);
  assert.equal(isStickerPath(C, 123), false);
  assert.equal(isStickerPath(C, null), false);
});

test('figurinha: só .webp de até 1 MB', () => {
  assert.deepEqual(validateStickerFile({ mime: 'image/webp', size: 20_000 }), { ok: true, value: { mime: 'image/webp', size: 20000 } });
  assert.equal(validateStickerFile({ mime: 'image/webp', size: MAX_STICKER_BYTES }).ok, true);
  assert.equal(validateStickerFile({ mime: 'image/webp', size: MAX_STICKER_BYTES + 1 }).ok, false);
  assert.equal(validateStickerFile({ mime: 'image/png', size: 100 }).ok, false);
  assert.equal(validateStickerFile({ mime: 'image/webp', size: 0 }).ok, false);
  assert.equal(validateStickerFile({ mime: 'image/webp', size: '10' }).ok, false);
  assert.equal(validateStickerFile({}).ok, false);
});

test('figurinha: nome para mostrar', () => {
  assert.equal(stickerName('Parabéns.webp'), 'Parabéns');
  assert.equal(stickerName('  muito   obrigado  '), 'muito obrigado');
  assert.equal(stickerName(''), null);
  assert.equal(stickerName(undefined, 'arquivo.webp'), 'arquivo');
  assert.equal(stickerName('x'.repeat(200))!.length, 80);
});
