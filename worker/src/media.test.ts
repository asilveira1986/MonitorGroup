import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaExtension, mediaInfo } from './media-info.js';

test('mediaExtension escolhe a extensão pelo tipo ou pelo nome', () => {
  assert.equal(mediaExtension('image/jpeg'), 'jpg');
  assert.equal(mediaExtension('audio/ogg; codecs=opus'), 'ogg');
  assert.equal(mediaExtension('image/webp'), 'webp');
  assert.equal(mediaExtension('application/vnd.ms-excel', 'Planilha.XLS'), 'xls');
  assert.equal(mediaExtension('application/x-foo'), 'xfoo');
});

test('mediaInfo lê tipo, tamanho e nome sem baixar', () => {
  const info = mediaInfo({
    key: {},
    message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', fileLength: 4321, ptt: true, seconds: 37 } },
  } as never);
  assert.deepEqual(info, { mime: 'audio/ogg; codecs=opus', size: 4321, fileName: null, seconds: 37 });
  assert.equal(mediaInfo({ key: {}, message: null } as never), null);
});
