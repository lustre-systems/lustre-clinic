const { withGradleProperties } = require('expo/config-plugins');

const PROPERTIES = [
    { key: 'reactNativeArchitectures', value: 'x86_64' },
    { key: 'org.gradle.jvmargs', value: '-Xmx1536m -XX:MaxMetaspaceSize=512m' },
    { key: 'org.gradle.workers.max', value: '3' },
    { key: 'kotlin.daemon.jvmargs', value: '-Xmx1024m' },
];

function applyProperties(items) {
    const next = [...items];
    for (const { key, value } of PROPERTIES) {
        const existing = next.find((item) => item.type === 'property' && item.key === key);
        if (existing) {
            existing.value = value;
        } else {
            next.push({ type: 'property', key, value });
        }
    }
    return next;
}

module.exports = function withBuildTuning(config) {
    return withGradleProperties(config, (cfg) => {
        cfg.modResults = applyProperties(cfg.modResults);
        return cfg;
    });
};

module.exports.applyProperties = applyProperties;
module.exports.PROPERTIES = PROPERTIES;
