import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddService, validateNewService } from './AddService';

const input = {
  name: ' API ',
  url: ' https://api.example.com/health ',
  interval: '60',
  timeout: '10',
  enabled: true,
};

test('new service validation trims fields and preserves monitoring configuration', () => {
  assert.deepEqual(validateNewService(input), {
    valid: true,
    service: {
      name: 'API',
      url: 'https://api.example.com/health',
      intervalSeconds: 60,
      timeoutSeconds: 10,
      enabled: true,
    },
  });
  const result = validateNewService({
    ...input,
    url: 'http://localhost:3000',
    interval: '0.001',
    enabled: false,
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.service.enabled, false);
    assert.equal(result.service.intervalSeconds, 0.001);
  }
});

test('new service validation rejects blank names and unsupported or relative URLs', () => {
  for (const url of ['', '/health', 'ftp://example.com', 'not a URL']) {
    const result = validateNewService({ ...input, name: '   ', url });
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.name);
      assert.ok(result.errors.url);
    }
  }
});

test('duration validation rejects zero, negative, invalid, submillisecond, and oversized values', () => {
  for (const value of [
    '',
    '0',
    '-1',
    'NaN',
    'Infinity',
    '0.0001',
    '9007199254740991',
  ]) {
    const result = validateNewService({
      ...input,
      interval: value,
      timeout: value,
    });
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.errors.interval);
      assert.ok(result.errors.timeout);
    }
  }
});

test('add service screen exposes labelled fields, defaults, and save and cancel actions', () => {
  const html = renderToStaticMarkup(
    createElement(AddService, { onClose() {}, onSave() {} }),
  );
  assert.match(html, /<dialog[^>]*aria-labelledby="add-service-title"/);
  for (const field of ['name', 'url', 'interval', 'timeout', 'enabled'])
    assert.match(html, new RegExp(`for="add-${field}"`));
  assert.match(html, /name="interval"[^>]*value="60"/);
  assert.match(html, /name="timeout"[^>]*value="10"/);
  assert.match(html, /name="enabled"[^>]*checked=""/);
  assert.match(html, /type="submit">Save service/);
  assert.match(html, />Cancel<\/button>/);
});
