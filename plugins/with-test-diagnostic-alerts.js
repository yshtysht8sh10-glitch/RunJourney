const { withAndroidManifest } = require('expo/config-plugins');
function permission(manifest) {
  const list = manifest['uses-permission'] ??= [];
  if (!list.some(item => item.$?.['android:name'] === 'android.permission.POST_NOTIFICATIONS')) {
    list.push({ $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' } });
  }
  return manifest;
}
module.exports = config => process.env.RUNJOURNEY_SENSOR_DIAGNOSTICS !== '1' ? config
  : withAndroidManifest(config, mod => { permission(mod.modResults.manifest); return mod; });
module.exports.permission = permission;
