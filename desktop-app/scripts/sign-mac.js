'use strict';

const path = require('path');
const { signAsync } = require('@electron/osx-sign');
const { HELPER_IDS, verifyMacApp } = require('../src/macSigningPolicy');

module.exports = async function signMac(options) {
  if (!options.identity || options.identity === '-') {
    throw new Error('Talio macOS packages require the Developer ID Application certificate. Ad-hoc signing resets privacy permissions after updates.');
  }
  const originalOptions = options.optionsForFile;
  await signAsync({
    ...options,
    optionsForFile: file => {
      const settings = originalOptions ? originalOptions(file) : {};
      const relativePath = path.relative(options.app, file).split(path.sep).join('/');
      const identifier = HELPER_IDS[relativePath];
      // swiftc/PyInstaller otherwise leave content-derived identifiers on these
      // standalone executables. Preserve builder entitlements and signing order.
      return identifier ? {
        ...settings,
        additionalArguments: [...(settings.additionalArguments || []), '--identifier', identifier],
      } : settings;
    },
  });
  await verifyMacApp(options.app);
};
