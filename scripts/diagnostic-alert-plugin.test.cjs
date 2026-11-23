const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugins/with-test-diagnostic-alerts');
test('Test alert permission is added once without altering existing permissions', () => {
  const gps = { $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' } };
  const manifest = { 'uses-permission': [gps] };
  plugin.permission(manifest); plugin.permission(manifest);
  assert.equal(manifest['uses-permission'].length, 2);
  assert.deepEqual(manifest['uses-permission'][0], gps);
});
test('default/Production config has no notification modification', () => {
  const saved = process.env.RUNJOURNEY_SENSOR_DIAGNOSTICS;
  try { delete process.env.RUNJOURNEY_SENSOR_DIAGNOSTICS; const config = {}; assert.equal(plugin(config), config); assert.deepEqual(config, {}); }
  finally { if (saved !== undefined) process.env.RUNJOURNEY_SENSOR_DIAGNOSTICS = saved; }
});
