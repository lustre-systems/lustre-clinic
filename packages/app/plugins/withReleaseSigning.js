const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @lustre: release signing (plugins/withReleaseSigning.js)';

const PROPERTIES = [
    'LUSTRE_RELEASE_STORE_FILE',
    'LUSTRE_RELEASE_STORE_PASSWORD',
    'LUSTRE_RELEASE_KEY_ALIAS',
    'LUSTRE_RELEASE_KEY_PASSWORD',
];

const PREAMBLE = `${MARKER}
def lustreSigning = [${PROPERTIES.map((name) => `'${name}'`).join(', ')}].collectEntries { [(it): findProperty(it)] }
def lustreSigningMissing = lustreSigning.findAll { !it.value }.collect { it.key }
def lustreSigningProblem = null
if (!lustreSigningMissing.isEmpty()) {
    lustreSigningProblem = "these Gradle properties are not set: \${lustreSigningMissing.join(', ')}"
} else if (!file(lustreSigning.LUSTRE_RELEASE_STORE_FILE).exists()) {
    lustreSigningProblem = "there is no keystore at \${lustreSigning.LUSTRE_RELEASE_STORE_FILE}"
}
gradle.taskGraph.whenReady { graph ->
    if (lustreSigningProblem && graph.allTasks.any { it.project == project && it.name.contains('Release') }) {
        throw new GradleException("A release build is signed with the Lustre release keystore, and \${lustreSigningProblem}. Set them in ~/.gradle/gradle.properties (infra/README.md, Release signing). Refusing to fall back to the debug key.")
    }
}
`;

const RELEASE_SIGNING_CONFIG = `        release {
            if (!lustreSigningProblem) {
                storeFile file(lustreSigning.LUSTRE_RELEASE_STORE_FILE)
                storePassword lustreSigning.LUSTRE_RELEASE_STORE_PASSWORD
                keyAlias lustreSigning.LUSTRE_RELEASE_KEY_ALIAS
                keyPassword lustreSigning.LUSTRE_RELEASE_KEY_PASSWORD
            }
        }
`;

const RELEASE_BUILD_TYPE = /(buildTypes\s*\{[\s\S]*?release\s*\{[^}]*?signingConfig\s+)signingConfigs\.debug/;
const SIGNING_CONFIGS = /signingConfigs\s*\{\n/;
const ANDROID_BLOCK = /\nandroid\s*\{/;

function applyReleaseSigning(contents) {
    if (contents.includes(MARKER)) return contents;

    for (const pattern of [RELEASE_BUILD_TYPE, SIGNING_CONFIGS, ANDROID_BLOCK]) {
        if (!pattern.test(contents)) {
            throw new Error(
                `withReleaseSigning: app/build.gradle no longer matches ${pattern}. The prebuild template changed; update the plugin.`,
            );
        }
    }

    return contents
        .replace(RELEASE_BUILD_TYPE, '$1signingConfigs.release')
        .replace(SIGNING_CONFIGS, (match) => `${match}${RELEASE_SIGNING_CONFIG}`)
        .replace(ANDROID_BLOCK, (match) => `\n${PREAMBLE}${match}`);
}

module.exports = function withReleaseSigning(config) {
    return withAppBuildGradle(config, (cfg) => {
        cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
        return cfg;
    });
};

module.exports.applyReleaseSigning = applyReleaseSigning;
module.exports.PROPERTIES = PROPERTIES;
