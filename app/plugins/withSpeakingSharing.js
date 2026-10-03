const withExpoSharing = require('expo-sharing/app.plugin').default;

/** @type {import('expo/config-plugins').ConfigPlugin<unknown>} */
module.exports = function withSpeakingSharing(config, options) {
  const originalScheme = config.scheme;
  // SDK 57 的分享扩展只接受一个回调 scheme；主应用仍保留微信回调。
  const sharingScheme = Array.isArray(originalScheme) ? originalScheme[0] : originalScheme;
  const result = withExpoSharing({ ...config, scheme: sharingScheme }, options);
  result.scheme = originalScheme;
  return result;
};
