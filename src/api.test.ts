import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deepgramPath,
  errorDetail,
  parseBaseUrl,
  parseUpdate,
  readDeepgram,
  readReply,
  readSegments,
  rolesInUse,
  storedApis,
} from './api.ts';

test('parseBaseUrl takes https anywhere and http only on this machine', () => {
  assert.equal(parseBaseUrl(' https://api.openai.com/v1/ '), 'https://api.openai.com/v1');
  assert.equal(parseBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(parseBaseUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');
  assert.equal(parseBaseUrl('http://[::1]:8000/v1'), 'http://[::1]:8000/v1');
  assert.equal(parseBaseUrl('http://api.openai.com/v1'), null);
  assert.equal(parseBaseUrl('http://localhost.evil.com/v1'), null);
  assert.equal(parseBaseUrl('file:///etc/passwd'), null);
  assert.equal(parseBaseUrl('not a url'), null);
});

test('parseBaseUrl refuses a login, a query and a fragment', () => {
  assert.equal(parseBaseUrl('https://user:pass@api.example.com/v1'), null);
  assert.equal(parseBaseUrl('https://api.example.com/v1?x=1'), null);
  assert.equal(parseBaseUrl('https://api.example.com/v1#x'), null);
});

const off = { baseUrl: '', model: '' };
const update = { engine: 'claude', speech: 'whisper', apis: { speech: off, summary: off } };
const summaryApi = (summary: object) => ({ ...update, engine: 'api', apis: { speech: off, summary } });
const speechApi = (speech: object, engine = 'api') => ({ ...update, speech: engine, apis: { speech, summary: off } });

test('parseUpdate takes the codex command and a summary switched off', () => {
  assert.equal(parseUpdate({ ...update, engine: 'codex' }).engine, 'codex');
  assert.equal(parseUpdate({ ...update, engine: 'off' }).engine, 'off');
  assert.deepEqual(rolesInUse({ engine: 'off', speech: 'whisper' }), []);
});

test('parseUpdate normalises a good update and keeps a missing key missing', () => {
  assert.deepEqual(
    parseUpdate(summaryApi({ baseUrl: 'https://openrouter.ai/api/v1/', model: ' gpt-6-luna ' })),
    summaryApi({ baseUrl: 'https://openrouter.ai/api/v1', model: 'gpt-6-luna' }),
  );
  assert.deepEqual(
    parseUpdate({ ...update, apis: { speech: { ...off, key: '' }, summary: off } }),
    { ...update, apis: { speech: { ...off, key: '' }, summary: off } },
  );
  assert.deepEqual(
    parseUpdate(speechApi({ baseUrl: 'https://api.deepgram.com/v1', model: ' nova-3 ', key: ' dg ' }, 'deepgram')),
    speechApi({ baseUrl: 'https://api.deepgram.com/v1', model: 'nova-3', key: 'dg' }, 'deepgram'),
  );
});

test('parseUpdate refuses what main must not store', () => {
  const api = summaryApi({ baseUrl: 'https://a.b/v1', model: 'm' });
  assert.throws(() => parseUpdate(null));
  assert.throws(() => parseUpdate({ ...update, engine: 'toString' }));
  assert.throws(() => parseUpdate({ ...update, speech: 'toString' }));
  assert.throws(() => parseUpdate({ ...update, speech: undefined }));
  assert.throws(() => parseUpdate({ ...update, apis: undefined }));
  assert.throws(() => parseUpdate(summaryApi({ baseUrl: '', model: 'm' })));
  assert.throws(() => parseUpdate(summaryApi({ baseUrl: 'https://a.b/v1', model: ' ' })));
  assert.throws(() => parseUpdate({ ...api, speech: 'api' })); // the transcription's API is not set up
  assert.throws(() => parseUpdate(speechApi({ baseUrl: '', model: 'whisper-1' }))); // no address
  assert.throws(() => parseUpdate(speechApi({ baseUrl: 'https://a.b/v1', model: 42 })));
  assert.throws(() => parseUpdate(summaryApi({ baseUrl: 'http://example.com', model: 'm' })));
  assert.throws(() => parseUpdate(summaryApi({ baseUrl: 'https://a.b/v1', model: 'm', key: 'sk-1\nX-Evil: 1' })));
  assert.throws(() => parseUpdate(summaryApi({ baseUrl: 'https://a.b/v1', model: 'm', key: 42 })));
});

test('rolesInUse names the APIs the chosen engines call', () => {
  assert.deepEqual(rolesInUse({ engine: 'claude', speech: 'whisper' }), []);
  assert.deepEqual(rolesInUse({ engine: 'api', speech: 'deepgram' }), ['speech', 'summary']);
  assert.deepEqual(rolesInUse({ engine: 'claude', speech: 'api' }), ['speech']);
});

test('storedApis turns the one shared API of 0.8.7 into two with the same address and key', () => {
  const old = {
    engine: 'api',
    speech: 'api',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt',
    speechModel: 'w',
    key: 'Q0lQSA==',
  };
  assert.deepEqual(storedApis(old), {
    speech: { baseUrl: 'https://api.openai.com/v1', model: 'w', key: 'Q0lQSA==' },
    summary: { baseUrl: 'https://api.openai.com/v1', model: 'gpt', key: 'Q0lQSA==' },
  });
  const current = { apis: { speech: { baseUrl: 'https://api.deepgram.com/v1', model: 'nova-3', key: 'a' } } };
  assert.deepEqual(storedApis(current), {
    speech: { baseUrl: 'https://api.deepgram.com/v1', model: 'nova-3', key: 'a' },
    summary: { baseUrl: '', model: '', key: null },
  });
  // A hand-edited file: an address main would not send a key to is dropped, odd values become nothing.
  assert.deepEqual(storedApis({ apis: { speech: { baseUrl: 'http://evil.com', model: 1, key: 2 }, summary: 'x' } }), {
    speech: { baseUrl: '', model: '', key: null },
    summary: { baseUrl: '', model: '', key: null },
  });
});

test('readReply takes the first choice and nothing else', () => {
  assert.equal(readReply({ choices: [{ message: { content: '  hi \n' } }] }), 'hi');
  assert.equal(readReply({ choices: [{ message: { content: '   ' } }] }), null);
  assert.equal(readReply({ choices: [] }), null);
  assert.equal(readReply({ choices: 'x' }), null);
  assert.equal(readReply(null), null);
  assert.equal(readReply('text'), null);
});

test('errorDetail reads OpenAI-style errors and falls back to the text', () => {
  assert.equal(errorDetail('{"error":{"message":"Incorrect API key"}}'), 'Incorrect API key');
  assert.equal(errorDetail('{"error":"model not found"}'), 'model not found');
  assert.equal(errorDetail(' Bad Gateway '), 'Bad Gateway');
  assert.equal(errorDetail('x'.repeat(1000)).length, 300);
});

test('errorDetail reads Gemini, Anthropic and Deepgram errors too', () => {
  assert.equal(errorDetail('[{"error":{"code":400,"message":"API key not valid"}}]'), 'API key not valid');
  assert.equal(errorDetail('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'),
    'invalid x-api-key');
  assert.equal(errorDetail('{"err_code":"INVALID_AUTH","err_msg":"Invalid credentials."}'), 'Invalid credentials.');
  assert.equal(errorDetail('{"category":"INVALID_AUTH","message":"Invalid credentials."}'), 'Invalid credentials.');
  assert.equal(errorDetail('[]'), '[]');
});

test('deepgramPath asks for sentences, and for detection when no language is set', () => {
  assert.equal(deepgramPath('nova-3', 'uk'), '/listen?model=nova-3&smart_format=true&paragraphs=true&language=uk');
  assert.equal(
    deepgramPath('nova-3', null),
    '/listen?model=nova-3&smart_format=true&paragraphs=true&detect_language=true',
  );
});

test('readDeepgram takes the sentences of the paragraphs and refuses anything else', () => {
  const reply = (alternative: object) => ({ results: { channels: [{ alternatives: [alternative] }] } });
  const sentences = [{ text: 'Привіт.', start: 0.1, end: 1 }, { text: 'Як справи?', start: 1.2, end: 2.5 }];
  assert.deepEqual(
    readDeepgram(reply({
      transcript: 'Привіт. Як справи? Добре.',
      paragraphs: { paragraphs: [{ sentences }, { sentences: [{ text: ' Добре. ', start: 3, end: 3.6 }] }] },
    })),
    [
      { start: 0.1, end: 1, text: 'Привіт.' },
      { start: 1.2, end: 2.5, text: 'Як справи?' },
      { start: 3, end: 3.6, text: 'Добре.' },
    ],
  );
  assert.deepEqual(readDeepgram(reply({ transcript: '' })), []); // silence
  assert.equal(readDeepgram(reply({ transcript: 'no paragraphs' })), null);
  assert.equal(readDeepgram({ results: { channels: [] } }), null);
  assert.equal(readDeepgram(null), null);
});

test('readSegments takes verbose_json segments and refuses a body without them', () => {
  assert.deepEqual(
    readSegments({
      text: 'a b',
      segments: [{ start: 0, end: 1.5, text: ' a ' }, { start: 1.5, end: 1.5, text: 'b' }, { start: 2, text: ' ' }],
    }),
    [{ start: 0, end: 1.5, text: 'a' }, { start: 1.5, end: 2.7, text: 'b' }],
  );
  assert.deepEqual(readSegments({ text: '', segments: [] }), []);
  assert.equal(readSegments({ text: 'no timestamps' }), null);
  assert.equal(readSegments(null), null);
});
