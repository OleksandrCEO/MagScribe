import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorDetail, parseBaseUrl, parseUpdate, readReply } from './api.ts';

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

test('parseUpdate normalises a good update and keeps a missing key missing', () => {
  assert.deepEqual(parseUpdate({ engine: 'api', baseUrl: 'https://openrouter.ai/api/v1/', model: ' gpt-4o-mini ' }), {
    engine: 'api',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'gpt-4o-mini',
  });
  assert.deepEqual(parseUpdate({ engine: 'claude', baseUrl: '', model: '', key: '' }), {
    engine: 'claude',
    baseUrl: '',
    model: '',
    key: '',
  });
});

test('parseUpdate refuses what main must not store', () => {
  assert.throws(() => parseUpdate(null));
  assert.throws(() => parseUpdate({ engine: 'toString', baseUrl: '', model: '' }));
  assert.throws(() => parseUpdate({ engine: 'api', baseUrl: '', model: 'm' }));
  assert.throws(() => parseUpdate({ engine: 'api', baseUrl: 'https://a.b/v1', model: ' ' }));
  assert.throws(() => parseUpdate({ engine: 'claude', baseUrl: 'http://example.com', model: '' }));
  assert.throws(() => parseUpdate({ engine: 'api', baseUrl: 'https://a.b/v1', model: 'm', key: 'sk-1\nX-Evil: 1' }));
  assert.throws(() => parseUpdate({ engine: 'api', baseUrl: 'https://a.b/v1', model: 'm', key: 42 }));
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
