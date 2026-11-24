const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @lustre: release versionCode (plugins/withReleaseVersionCode.js)';

const EPOCH_MS = 1_767_225_600_000;

const STEP_MS = 10_000;

const BLOCK = `${MARKER}
androidComponents {
    ['release', 'devRelease'].each { buildType ->
        onVariants(selector().withBuildType(buildType)) { variant ->
            def forced = findProperty('LUSTRE_VERSION_CODE')
            int lustreVersionCode = forced ? forced.toInteger() : ((System.currentTimeMillis() - ${EPOCH_MS}L).intdiv(${STEP_MS}L)) as int
            variant.outputs.each { output -> output.versionCode.set(lustreVersionCode) }
        }
    }
}
`;

function applyReleaseVersionCode(contents) {
    if (contents.includes(MARKER)) return contents;
    return `${contents.trimEnd()}\n\n${BLOCK}`;
}

function versionCodeAt(nowMs) {
    return Math.floor((nowMs - EPOCH_MS) / STEP_MS);
}

module.exports = function withReleaseVersionCode(config) {
    return withAppBuildGradle(config, (cfg) => {
        cfg.modResults.contents = applyReleaseVersionCode(cfg.modResults.contents);
        return cfg;
    });
};

module.exports.applyReleaseVersionCode = applyReleaseVersionCode;
module.exports.versionCodeAt = versionCodeAt;
module.exports.EPOCH_MS = EPOCH_MS;
module.exports.STEP_MS = STEP_MS;
