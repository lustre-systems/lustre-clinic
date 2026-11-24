const fs = require('node:fs/promises');
const path = require('node:path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const MARKER = '// @lustre: dev application id (plugins/withDevIdentity.js)';

const APPLICATION_ID_SUFFIX = '.dev';
const DEV_APP_NAME = 'Lustre DEV';

const DEBUG_BUILD_TYPE = /(buildTypes\s*\{[^}]*?debug\s*\{[^\S\n]*\r?\n)/;
const BUILD_TYPES_BLOCK = /(\n {4}buildTypes \{[\s\S]*?)(\n {4}\})/;
const DEV_RELEASE_MARKER = '// @lustre: OTA development build (plugins/withDevIdentity.js)';

function applyDevReleaseBuildType(contents) {
    if (contents.includes(DEV_RELEASE_MARKER)) return contents;
    if (!BUILD_TYPES_BLOCK.test(contents)) {
        throw new Error('withDevIdentity: app/build.gradle has no buildTypes block');
    }
    return contents.replace(
        BUILD_TYPES_BLOCK,
        (_, body, close) => `${body}
        devRelease {
            ${DEV_RELEASE_MARKER}
            initWith release
            matchingFallbacks = ['release']
            applicationIdSuffix '${APPLICATION_ID_SUFFIX}'
            signingConfig signingConfigs.debug
        }${close}`,
    );
}

function applyDevApplicationId(contents) {
    if (contents.includes(MARKER)) return contents;

    if (!DEBUG_BUILD_TYPE.test(contents)) {
        throw new Error(
            `withDevIdentity: app/build.gradle no longer matches ${DEBUG_BUILD_TYPE}. The prebuild template changed; update the plugin.`,
        );
    }

    return contents.replace(
        DEBUG_BUILD_TYPE,
        (match) =>
            `${match}            ${MARKER}\n            applicationIdSuffix '${APPLICATION_ID_SUFFIX}'\n`,
    );
}

const DEV_STRINGS_PATH = path.join('app', 'src', 'debug', 'res', 'values', 'strings.xml');
const DEV_RELEASE_STRINGS_PATH = path.join('app', 'src', 'devRelease', 'res', 'values', 'strings.xml');

const DEV_STRINGS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">${DEV_APP_NAME}</string>
</resources>
`;

module.exports = function withDevIdentity(config) {
    const suffixed = withAppBuildGradle(config, (cfg) => {
        cfg.modResults.contents = applyDevReleaseBuildType(applyDevApplicationId(cfg.modResults.contents));
        return cfg;
    });

    return withDangerousMod(suffixed, [
        'android',
        async (cfg) => {
            const file = path.join(cfg.modRequest.platformProjectRoot, DEV_STRINGS_PATH);
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, DEV_STRINGS_XML);
            const releaseFile = path.join(cfg.modRequest.platformProjectRoot, DEV_RELEASE_STRINGS_PATH);
            await fs.mkdir(path.dirname(releaseFile), { recursive: true });
            await fs.writeFile(releaseFile, DEV_STRINGS_XML);
            return cfg;
        },
    ]);
};

module.exports.applyDevApplicationId = applyDevApplicationId;
module.exports.applyDevReleaseBuildType = applyDevReleaseBuildType;
module.exports.APPLICATION_ID_SUFFIX = APPLICATION_ID_SUFFIX;
module.exports.DEV_APP_NAME = DEV_APP_NAME;
module.exports.DEV_STRINGS_PATH = DEV_STRINGS_PATH;
module.exports.DEV_RELEASE_STRINGS_PATH = DEV_RELEASE_STRINGS_PATH;
module.exports.DEV_STRINGS_XML = DEV_STRINGS_XML;
