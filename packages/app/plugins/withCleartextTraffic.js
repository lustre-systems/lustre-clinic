const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

function allowCleartext(manifest) {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.$['android:usesCleartextTraffic'] = 'true';
    return manifest;
}

module.exports = function withCleartextTraffic(config) {
    return withAndroidManifest(config, (cfg) => {
        cfg.modResults = allowCleartext(cfg.modResults);
        return cfg;
    });
};

module.exports.allowCleartext = allowCleartext;
