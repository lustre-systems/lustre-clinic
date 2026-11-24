const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

const ITEMS = {
    'android:enforceNavigationBarContrast': 'false',
    'android:windowLightNavigationBar': 'true',
};

function styleNavigationBar(styles) {
    let next = styles;
    for (const [name, value] of Object.entries(ITEMS)) {
        next = AndroidConfig.Styles.assignStylesValue(next, {
            add: true,
            parent: AndroidConfig.Styles.getAppThemeGroup(),
            name,
            value,
        });
    }
    return next;
}

module.exports = function withNavigationBarContrast(config) {
    return withAndroidStyles(config, (cfg) => {
        cfg.modResults = styleNavigationBar(cfg.modResults);
        return cfg;
    });
};

module.exports.styleNavigationBar = styleNavigationBar;
