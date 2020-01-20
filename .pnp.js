#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["canvas", new Map([
    ["2.6.1", {
      packageLocation: path.resolve(__dirname, "./.pnp/unplugged/npm-canvas-2.6.1-0d087dd4d60f5a5a9efa202757270abea8bef89e-integrity/node_modules/canvas/"),
      packageDependencies: new Map([
        ["nan", "2.14.0"],
        ["node-pre-gyp", "0.11.0"],
        ["simple-get", "3.1.0"],
        ["canvas", "2.6.1"],
      ]),
    }],
  ])],
  ["nan", new Map([
    ["2.14.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-nan-2.14.0-7818f722027b2459a86f0295d434d1fc2336c52c-integrity/node_modules/nan/"),
      packageDependencies: new Map([
        ["nan", "2.14.0"],
      ]),
    }],
  ])],
  ["node-pre-gyp", new Map([
    ["0.11.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-node-pre-gyp-0.11.0-db1f33215272f692cd38f03238e3e9b47c5dd054-integrity/node_modules/node-pre-gyp/"),
      packageDependencies: new Map([
        ["detect-libc", "1.0.3"],
        ["mkdirp", "0.5.1"],
        ["needle", "2.4.0"],
        ["nopt", "4.0.1"],
        ["npm-packlist", "1.4.7"],
        ["npmlog", "4.1.2"],
        ["rc", "1.2.8"],
        ["rimraf", "2.7.1"],
        ["semver", "5.7.1"],
        ["tar", "4.4.13"],
        ["node-pre-gyp", "0.11.0"],
      ]),
    }],
  ])],
  ["detect-libc", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-detect-libc-1.0.3-fa137c4bd698edf55cd5cd02ac559f91a4c4ba9b-integrity/node_modules/detect-libc/"),
      packageDependencies: new Map([
        ["detect-libc", "1.0.3"],
      ]),
    }],
  ])],
  ["mkdirp", new Map([
    ["0.5.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903-integrity/node_modules/mkdirp/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
        ["mkdirp", "0.5.1"],
      ]),
    }],
  ])],
  ["minimist", new Map([
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d-integrity/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "0.0.8"],
      ]),
    }],
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-minimist-1.2.0-a35008b20f41383eec1fb914f4cd5df79a264284-integrity/node_modules/minimist/"),
      packageDependencies: new Map([
        ["minimist", "1.2.0"],
      ]),
    }],
  ])],
  ["needle", new Map([
    ["2.4.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-needle-2.4.0-6833e74975c444642590e15a750288c5f939b57c-integrity/node_modules/needle/"),
      packageDependencies: new Map([
        ["debug", "3.2.6"],
        ["iconv-lite", "0.4.24"],
        ["sax", "1.2.4"],
        ["needle", "2.4.0"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["3.2.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-debug-3.2.6-e83d17de16d8a7efb7717edbe5fb10135eee629b-integrity/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
        ["debug", "3.2.6"],
      ]),
    }],
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261-integrity/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "3.1.0"],
      ]),
    }],
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791-integrity/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
        ["debug", "4.1.1"],
      ]),
    }],
    ["2.6.9", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f-integrity/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "2.6.9"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009-integrity/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8-integrity/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
      ]),
    }],
  ])],
  ["iconv-lite", new Map([
    ["0.4.24", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b-integrity/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["iconv-lite", "0.4.24"],
      ]),
    }],
  ])],
  ["safer-buffer", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a-integrity/node_modules/safer-buffer/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
      ]),
    }],
  ])],
  ["sax", new Map([
    ["1.2.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-sax-1.2.4-2816234e2378bddc4e5354fab5caa895df7100d9-integrity/node_modules/sax/"),
      packageDependencies: new Map([
        ["sax", "1.2.4"],
      ]),
    }],
  ])],
  ["nopt", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-nopt-4.0.1-d0d4685afd5415193c8c7505602d0d17cd64474d-integrity/node_modules/nopt/"),
      packageDependencies: new Map([
        ["abbrev", "1.1.1"],
        ["osenv", "0.1.5"],
        ["nopt", "4.0.1"],
      ]),
    }],
  ])],
  ["abbrev", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-abbrev-1.1.1-f8f2c887ad10bf67f634f005b6987fed3179aac8-integrity/node_modules/abbrev/"),
      packageDependencies: new Map([
        ["abbrev", "1.1.1"],
      ]),
    }],
  ])],
  ["osenv", new Map([
    ["0.1.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-osenv-0.1.5-85cdfafaeb28e8677f416e287592b5f3f49ea410-integrity/node_modules/osenv/"),
      packageDependencies: new Map([
        ["os-homedir", "1.0.2"],
        ["os-tmpdir", "1.0.2"],
        ["osenv", "0.1.5"],
      ]),
    }],
  ])],
  ["os-homedir", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-os-homedir-1.0.2-ffbc4988336e0e833de0c168c7ef152121aa7fb3-integrity/node_modules/os-homedir/"),
      packageDependencies: new Map([
        ["os-homedir", "1.0.2"],
      ]),
    }],
  ])],
  ["os-tmpdir", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-os-tmpdir-1.0.2-bbe67406c79aa85c5cfec766fe5734555dfa1274-integrity/node_modules/os-tmpdir/"),
      packageDependencies: new Map([
        ["os-tmpdir", "1.0.2"],
      ]),
    }],
  ])],
  ["npm-packlist", new Map([
    ["1.4.7", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-npm-packlist-1.4.7-9e954365a06b80b18111ea900945af4f88ed4848-integrity/node_modules/npm-packlist/"),
      packageDependencies: new Map([
        ["ignore-walk", "3.0.3"],
        ["npm-bundled", "1.1.1"],
        ["npm-packlist", "1.4.7"],
      ]),
    }],
  ])],
  ["ignore-walk", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ignore-walk-3.0.3-017e2447184bfeade7c238e4aefdd1e8f95b1e37-integrity/node_modules/ignore-walk/"),
      packageDependencies: new Map([
        ["minimatch", "3.0.4"],
        ["ignore-walk", "3.0.3"],
      ]),
    }],
  ])],
  ["minimatch", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083-integrity/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "1.1.11"],
        ["minimatch", "3.0.4"],
      ]),
    }],
  ])],
  ["brace-expansion", new Map([
    ["1.1.11", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd-integrity/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
        ["concat-map", "0.0.1"],
        ["brace-expansion", "1.1.11"],
      ]),
    }],
  ])],
  ["balanced-match", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767-integrity/node_modules/balanced-match/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.0"],
      ]),
    }],
  ])],
  ["concat-map", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b-integrity/node_modules/concat-map/"),
      packageDependencies: new Map([
        ["concat-map", "0.0.1"],
      ]),
    }],
  ])],
  ["npm-bundled", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-npm-bundled-1.1.1-1edd570865a94cdb1bc8220775e29466c9fb234b-integrity/node_modules/npm-bundled/"),
      packageDependencies: new Map([
        ["npm-normalize-package-bin", "1.0.1"],
        ["npm-bundled", "1.1.1"],
      ]),
    }],
  ])],
  ["npm-normalize-package-bin", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-npm-normalize-package-bin-1.0.1-6e79a41f23fd235c0623218228da7d9c23b8f6e2-integrity/node_modules/npm-normalize-package-bin/"),
      packageDependencies: new Map([
        ["npm-normalize-package-bin", "1.0.1"],
      ]),
    }],
  ])],
  ["npmlog", new Map([
    ["4.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-npmlog-4.1.2-08a7f2a8bf734604779a9efa4ad5cc717abb954b-integrity/node_modules/npmlog/"),
      packageDependencies: new Map([
        ["are-we-there-yet", "1.1.5"],
        ["console-control-strings", "1.1.0"],
        ["gauge", "2.7.4"],
        ["set-blocking", "2.0.0"],
        ["npmlog", "4.1.2"],
      ]),
    }],
  ])],
  ["are-we-there-yet", new Map([
    ["1.1.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-are-we-there-yet-1.1.5-4b35c2944f062a8bfcda66410760350fe9ddfc21-integrity/node_modules/are-we-there-yet/"),
      packageDependencies: new Map([
        ["delegates", "1.0.0"],
        ["readable-stream", "2.3.7"],
        ["are-we-there-yet", "1.1.5"],
      ]),
    }],
  ])],
  ["delegates", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-delegates-1.0.0-84c6e159b81904fdca59a0ef44cd870d31250f9a-integrity/node_modules/delegates/"),
      packageDependencies: new Map([
        ["delegates", "1.0.0"],
      ]),
    }],
  ])],
  ["readable-stream", new Map([
    ["2.3.7", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-readable-stream-2.3.7-1eca1cf711aef814c04f62252a36a62f6cb23b57-integrity/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
        ["inherits", "2.0.4"],
        ["isarray", "1.0.0"],
        ["process-nextick-args", "2.0.1"],
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "2.3.7"],
      ]),
    }],
    ["3.5.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-readable-stream-3.5.0-465d70e6d1087f6162d079cd0b5db7fbebfd1606-integrity/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["string_decoder", "1.3.0"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "3.5.0"],
      ]),
    }],
  ])],
  ["core-util-is", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7-integrity/node_modules/core-util-is/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.2"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c-integrity/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11-integrity/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
      ]),
    }],
  ])],
  ["process-nextick-args", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2-integrity/node_modules/process-nextick-args/"),
      packageDependencies: new Map([
        ["process-nextick-args", "2.0.1"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d-integrity/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
      ]),
    }],
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-safe-buffer-5.2.0-b74daec49b1148f88c64b68d49b1e815c1f2f519-integrity/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.0"],
      ]),
    }],
  ])],
  ["string_decoder", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8-integrity/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
      ]),
    }],
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-string-decoder-1.3.0-42f114594a46cf1a8e30b0a84f56c78c3edac21e-integrity/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.0"],
        ["string_decoder", "1.3.0"],
      ]),
    }],
  ])],
  ["util-deprecate", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf-integrity/node_modules/util-deprecate/"),
      packageDependencies: new Map([
        ["util-deprecate", "1.0.2"],
      ]),
    }],
  ])],
  ["console-control-strings", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-console-control-strings-1.1.0-3d7cf4464db6446ea644bf4b39507f9851008e8e-integrity/node_modules/console-control-strings/"),
      packageDependencies: new Map([
        ["console-control-strings", "1.1.0"],
      ]),
    }],
  ])],
  ["gauge", new Map([
    ["2.7.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-gauge-2.7.4-2c03405c7538c39d7eb37b317022e325fb018bf7-integrity/node_modules/gauge/"),
      packageDependencies: new Map([
        ["aproba", "1.2.0"],
        ["console-control-strings", "1.1.0"],
        ["has-unicode", "2.0.1"],
        ["object-assign", "4.1.1"],
        ["signal-exit", "3.0.2"],
        ["string-width", "1.0.2"],
        ["strip-ansi", "3.0.1"],
        ["wide-align", "1.1.3"],
        ["gauge", "2.7.4"],
      ]),
    }],
  ])],
  ["aproba", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-aproba-1.2.0-6802e6264efd18c790a1b0d517f0f2627bf2c94a-integrity/node_modules/aproba/"),
      packageDependencies: new Map([
        ["aproba", "1.2.0"],
      ]),
    }],
  ])],
  ["has-unicode", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-has-unicode-2.0.1-e0e6fe6a28cf51138855e086d1691e771de2a8b9-integrity/node_modules/has-unicode/"),
      packageDependencies: new Map([
        ["has-unicode", "2.0.1"],
      ]),
    }],
  ])],
  ["object-assign", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-object-assign-4.1.1-2109adc7965887cfc05cbbd442cac8bfbb360863-integrity/node_modules/object-assign/"),
      packageDependencies: new Map([
        ["object-assign", "4.1.1"],
      ]),
    }],
  ])],
  ["signal-exit", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d-integrity/node_modules/signal-exit/"),
      packageDependencies: new Map([
        ["signal-exit", "3.0.2"],
      ]),
    }],
  ])],
  ["string-width", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-string-width-1.0.2-118bdf5b8cdc51a2a7e70d211e07e2b0b9b107d3-integrity/node_modules/string-width/"),
      packageDependencies: new Map([
        ["code-point-at", "1.1.0"],
        ["is-fullwidth-code-point", "1.0.0"],
        ["strip-ansi", "3.0.1"],
        ["string-width", "1.0.2"],
      ]),
    }],
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-string-width-2.1.1-ab93f27a8dc13d28cac815c462143a6d9012ae9e-integrity/node_modules/string-width/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "2.0.0"],
        ["strip-ansi", "4.0.0"],
        ["string-width", "2.1.1"],
      ]),
    }],
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-string-width-4.2.0-952182c46cc7b2c313d1596e623992bd163b72b5-integrity/node_modules/string-width/"),
      packageDependencies: new Map([
        ["emoji-regex", "8.0.0"],
        ["is-fullwidth-code-point", "3.0.0"],
        ["strip-ansi", "6.0.0"],
        ["string-width", "4.2.0"],
      ]),
    }],
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-string-width-3.1.0-22767be21b62af1081574306f69ac51b62203961-integrity/node_modules/string-width/"),
      packageDependencies: new Map([
        ["emoji-regex", "7.0.3"],
        ["is-fullwidth-code-point", "2.0.0"],
        ["strip-ansi", "5.2.0"],
        ["string-width", "3.1.0"],
      ]),
    }],
  ])],
  ["code-point-at", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-code-point-at-1.1.0-0d070b4d043a5bea33a2f1a40e2edb3d9a4ccf77-integrity/node_modules/code-point-at/"),
      packageDependencies: new Map([
        ["code-point-at", "1.1.0"],
      ]),
    }],
  ])],
  ["is-fullwidth-code-point", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-fullwidth-code-point-1.0.0-ef9e31386f031a7f0d643af82fde50c457ef00cb-integrity/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["number-is-nan", "1.0.1"],
        ["is-fullwidth-code-point", "1.0.0"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-fullwidth-code-point-2.0.0-a3b30a5c4f199183167aaab93beefae3ddfb654f-integrity/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "2.0.0"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-fullwidth-code-point-3.0.0-f116f8064fe90b3f7844a38997c0b75051269f1d-integrity/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "3.0.0"],
      ]),
    }],
  ])],
  ["number-is-nan", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-number-is-nan-1.0.1-097b602b53422a522c1afb8790318336941a011d-integrity/node_modules/number-is-nan/"),
      packageDependencies: new Map([
        ["number-is-nan", "1.0.1"],
      ]),
    }],
  ])],
  ["strip-ansi", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-strip-ansi-3.0.1-6a385fb8853d952d5ff05d0e8aaf94278dc63dcf-integrity/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
        ["strip-ansi", "3.0.1"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-strip-ansi-4.0.0-a8479022eb1ac368a871389b635262c505ee368f-integrity/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "3.0.0"],
        ["strip-ansi", "4.0.0"],
      ]),
    }],
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-strip-ansi-6.0.0-0b1571dd7669ccd4f3e06e14ef1eed26225ae532-integrity/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "5.0.0"],
        ["strip-ansi", "6.0.0"],
      ]),
    }],
    ["5.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-strip-ansi-5.2.0-8c9a536feb6afc962bdfa5b104a5091c1ad9c0ae-integrity/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "4.1.0"],
        ["strip-ansi", "5.2.0"],
      ]),
    }],
  ])],
  ["ansi-regex", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ansi-regex-2.1.1-c3b33ab5ee360d86e0e628f0468ae7ef27d654df-integrity/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "2.1.1"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ansi-regex-3.0.0-ed0317c322064f79466c02966bddb605ab37d998-integrity/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "3.0.0"],
      ]),
    }],
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ansi-regex-5.0.0-388539f55179bf39339c81af30a654d69f87cb75-integrity/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "5.0.0"],
      ]),
    }],
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ansi-regex-4.1.0-8b9f8f08cf1acb843756a839ca8c7e3168c51997-integrity/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "4.1.0"],
      ]),
    }],
  ])],
  ["wide-align", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-wide-align-1.1.3-ae074e6bdc0c14a431e804e624549c633b000457-integrity/node_modules/wide-align/"),
      packageDependencies: new Map([
        ["string-width", "2.1.1"],
        ["wide-align", "1.1.3"],
      ]),
    }],
  ])],
  ["set-blocking", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7-integrity/node_modules/set-blocking/"),
      packageDependencies: new Map([
        ["set-blocking", "2.0.0"],
      ]),
    }],
  ])],
  ["rc", new Map([
    ["1.2.8", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-rc-1.2.8-cd924bf5200a075b83c188cd6b9e211b7fc0d3ed-integrity/node_modules/rc/"),
      packageDependencies: new Map([
        ["deep-extend", "0.6.0"],
        ["ini", "1.3.5"],
        ["minimist", "1.2.0"],
        ["strip-json-comments", "2.0.1"],
        ["rc", "1.2.8"],
      ]),
    }],
  ])],
  ["deep-extend", new Map([
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-deep-extend-0.6.0-c4fa7c95404a17a9c3e8ca7e1537312b736330ac-integrity/node_modules/deep-extend/"),
      packageDependencies: new Map([
        ["deep-extend", "0.6.0"],
      ]),
    }],
  ])],
  ["ini", new Map([
    ["1.3.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ini-1.3.5-eee25f56db1c9ec6085e0c22778083f596abf927-integrity/node_modules/ini/"),
      packageDependencies: new Map([
        ["ini", "1.3.5"],
      ]),
    }],
  ])],
  ["strip-json-comments", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-strip-json-comments-2.0.1-3c531942e908c2697c0ec344858c286c7ca0a60a-integrity/node_modules/strip-json-comments/"),
      packageDependencies: new Map([
        ["strip-json-comments", "2.0.1"],
      ]),
    }],
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-strip-json-comments-3.0.1-85713975a91fb87bf1b305cca77395e40d2a64a7-integrity/node_modules/strip-json-comments/"),
      packageDependencies: new Map([
        ["strip-json-comments", "3.0.1"],
      ]),
    }],
  ])],
  ["rimraf", new Map([
    ["2.7.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-rimraf-2.7.1-35797f13a7fdadc566142c29d4f07ccad483e3ec-integrity/node_modules/rimraf/"),
      packageDependencies: new Map([
        ["glob", "7.1.6"],
        ["rimraf", "2.7.1"],
      ]),
    }],
    ["2.6.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-rimraf-2.6.3-b2d104fe0d8fb27cf9e0a1cda8262dd3833c6cab-integrity/node_modules/rimraf/"),
      packageDependencies: new Map([
        ["glob", "7.1.6"],
        ["rimraf", "2.6.3"],
      ]),
    }],
  ])],
  ["glob", new Map([
    ["7.1.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-glob-7.1.6-141f33b81a7c2492e125594307480c46679278a6-integrity/node_modules/glob/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
        ["inflight", "1.0.6"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.0.4"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "7.1.6"],
      ]),
    }],
  ])],
  ["fs.realpath", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f-integrity/node_modules/fs.realpath/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
      ]),
    }],
  ])],
  ["inflight", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9-integrity/node_modules/inflight/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["wrappy", "1.0.2"],
        ["inflight", "1.0.6"],
      ]),
    }],
  ])],
  ["once", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1-integrity/node_modules/once/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
        ["once", "1.4.0"],
      ]),
    }],
  ])],
  ["wrappy", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f-integrity/node_modules/wrappy/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f-integrity/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["semver", new Map([
    ["5.7.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7-integrity/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "5.7.1"],
      ]),
    }],
    ["7.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-semver-7.1.1-29104598a197d6cbe4733eeecbe968f7b43a9667-integrity/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "7.1.1"],
      ]),
    }],
    ["6.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-semver-6.3.0-ee0a64c8af5e8ceea67687b133761e1becbd1d3d-integrity/node_modules/semver/"),
      packageDependencies: new Map([
        ["semver", "6.3.0"],
      ]),
    }],
  ])],
  ["tar", new Map([
    ["4.4.13", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-tar-4.4.13-43b364bc52888d555298637b10d60790254ab525-integrity/node_modules/tar/"),
      packageDependencies: new Map([
        ["chownr", "1.1.3"],
        ["fs-minipass", "1.2.7"],
        ["minipass", "2.9.0"],
        ["minizlib", "1.3.3"],
        ["mkdirp", "0.5.1"],
        ["safe-buffer", "5.2.0"],
        ["yallist", "3.1.1"],
        ["tar", "4.4.13"],
      ]),
    }],
    ["5.0.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-tar-5.0.5-03fcdb7105bc8ea3ce6c86642b9c942495b04f93-integrity/node_modules/tar/"),
      packageDependencies: new Map([
        ["chownr", "1.1.3"],
        ["fs-minipass", "2.0.0"],
        ["minipass", "3.1.1"],
        ["minizlib", "2.1.0"],
        ["mkdirp", "0.5.1"],
        ["yallist", "4.0.0"],
        ["tar", "5.0.5"],
      ]),
    }],
  ])],
  ["chownr", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-chownr-1.1.3-42d837d5239688d55f303003a508230fa6727142-integrity/node_modules/chownr/"),
      packageDependencies: new Map([
        ["chownr", "1.1.3"],
      ]),
    }],
  ])],
  ["fs-minipass", new Map([
    ["1.2.7", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-fs-minipass-1.2.7-ccff8570841e7fe4265693da88936c55aed7f7c7-integrity/node_modules/fs-minipass/"),
      packageDependencies: new Map([
        ["minipass", "2.9.0"],
        ["fs-minipass", "1.2.7"],
      ]),
    }],
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-fs-minipass-2.0.0-a6415edab02fae4b9e9230bc87ee2e4472003cd1-integrity/node_modules/fs-minipass/"),
      packageDependencies: new Map([
        ["minipass", "3.1.1"],
        ["fs-minipass", "2.0.0"],
      ]),
    }],
  ])],
  ["minipass", new Map([
    ["2.9.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-minipass-2.9.0-e713762e7d3e32fed803115cf93e04bca9fcc9a6-integrity/node_modules/minipass/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.0"],
        ["yallist", "3.1.1"],
        ["minipass", "2.9.0"],
      ]),
    }],
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-minipass-3.1.1-7607ce778472a185ad6d89082aa2070f79cedcd5-integrity/node_modules/minipass/"),
      packageDependencies: new Map([
        ["yallist", "4.0.0"],
        ["minipass", "3.1.1"],
      ]),
    }],
  ])],
  ["yallist", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-yallist-3.1.1-dbb7daf9bfd8bac9ab45ebf602b8cbad0d5d08fd-integrity/node_modules/yallist/"),
      packageDependencies: new Map([
        ["yallist", "3.1.1"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-yallist-4.0.0-9bb92790d9c0effec63be73519e11a35019a3a72-integrity/node_modules/yallist/"),
      packageDependencies: new Map([
        ["yallist", "4.0.0"],
      ]),
    }],
  ])],
  ["minizlib", new Map([
    ["1.3.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-minizlib-1.3.3-2290de96818a34c29551c8a8d301216bd65a861d-integrity/node_modules/minizlib/"),
      packageDependencies: new Map([
        ["minipass", "2.9.0"],
        ["minizlib", "1.3.3"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-minizlib-2.1.0-fd52c645301ef09a63a2c209697c294c6ce02cf3-integrity/node_modules/minizlib/"),
      packageDependencies: new Map([
        ["minipass", "3.1.1"],
        ["yallist", "4.0.0"],
        ["minizlib", "2.1.0"],
      ]),
    }],
  ])],
  ["simple-get", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-simple-get-3.1.0-b45be062435e50d159540b576202ceec40b9c6b3-integrity/node_modules/simple-get/"),
      packageDependencies: new Map([
        ["decompress-response", "4.2.1"],
        ["once", "1.4.0"],
        ["simple-concat", "1.0.0"],
        ["simple-get", "3.1.0"],
      ]),
    }],
  ])],
  ["decompress-response", new Map([
    ["4.2.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-decompress-response-4.2.1-414023cc7a302da25ce2ec82d0d5238ccafd8986-integrity/node_modules/decompress-response/"),
      packageDependencies: new Map([
        ["mimic-response", "2.0.0"],
        ["decompress-response", "4.2.1"],
      ]),
    }],
  ])],
  ["mimic-response", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mimic-response-2.0.0-996a51c60adf12cb8a87d7fb8ef24c2f3d5ebb46-integrity/node_modules/mimic-response/"),
      packageDependencies: new Map([
        ["mimic-response", "2.0.0"],
      ]),
    }],
  ])],
  ["simple-concat", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-simple-concat-1.0.0-7344cbb8b6e26fb27d66b2fc86f9f6d5997521c6-integrity/node_modules/simple-concat/"),
      packageDependencies: new Map([
        ["simple-concat", "1.0.0"],
      ]),
    }],
  ])],
  ["chalk", new Map([
    ["2.4.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424-integrity/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "3.2.1"],
        ["escape-string-regexp", "1.0.5"],
        ["supports-color", "5.5.0"],
        ["chalk", "2.4.2"],
      ]),
    }],
  ])],
  ["ansi-styles", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d-integrity/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["color-convert", "1.9.3"],
        ["ansi-styles", "3.2.1"],
      ]),
    }],
  ])],
  ["color-convert", new Map([
    ["1.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8-integrity/node_modules/color-convert/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
        ["color-convert", "1.9.3"],
      ]),
    }],
  ])],
  ["color-name", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25-integrity/node_modules/color-name/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
      ]),
    }],
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-color-name-1.1.4-c2a09a87acbde69543de6f63fa3995c826c536a2-integrity/node_modules/color-name/"),
      packageDependencies: new Map([
        ["color-name", "1.1.4"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4-integrity/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["5.5.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f-integrity/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
        ["supports-color", "5.5.0"],
      ]),
    }],
  ])],
  ["has-flag", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd-integrity/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
      ]),
    }],
  ])],
  ["chunk", new Map([
    ["0.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-chunk-0.0.2-04aa4f31664ae850de500cf8d57b5f4c29cd522e-integrity/node_modules/chunk/"),
      packageDependencies: new Map([
        ["chunk", "0.0.2"],
      ]),
    }],
  ])],
  ["jimp", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-jimp-0.9.3-85e8e80eea65a7e6de806c6bb622ec6a7244e6f3-integrity/node_modules/jimp/"),
      packageDependencies: new Map([
        ["@babel/runtime", "7.8.3"],
        ["@jimp/custom", "0.9.3"],
        ["@jimp/plugins", "0.9.3"],
        ["@jimp/types", "0.9.3"],
        ["core-js", "3.6.4"],
        ["regenerator-runtime", "0.13.3"],
        ["jimp", "0.9.3"],
      ]),
    }],
  ])],
  ["@babel/runtime", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@babel-runtime-7.8.3-0811944f73a6c926bb2ad35e918dcc1bfab279f1-integrity/node_modules/@babel/runtime/"),
      packageDependencies: new Map([
        ["regenerator-runtime", "0.13.3"],
        ["@babel/runtime", "7.8.3"],
      ]),
    }],
  ])],
  ["regenerator-runtime", new Map([
    ["0.13.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-regenerator-runtime-0.13.3-7cf6a77d8f5c6f60eb73c5fc1955b2ceb01e6bf5-integrity/node_modules/regenerator-runtime/"),
      packageDependencies: new Map([
        ["regenerator-runtime", "0.13.3"],
      ]),
    }],
  ])],
  ["@jimp/custom", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-custom-0.9.3-b49dfe1d6b24e62fd4101a7db77104024c8d97e8-integrity/node_modules/@jimp/custom/"),
      packageDependencies: new Map([
        ["@babel/runtime", "7.8.3"],
        ["@jimp/core", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/custom", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/core", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-core-0.9.3-bffbf955c046569bf4b682b575228e31bb41e445-integrity/node_modules/@jimp/core/"),
      packageDependencies: new Map([
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["any-base", "1.1.0"],
        ["buffer", "5.4.3"],
        ["core-js", "3.6.4"],
        ["exif-parser", "0.1.12"],
        ["file-type", "9.0.0"],
        ["load-bmfont", "1.4.0"],
        ["mkdirp", "0.5.1"],
        ["phin", "2.9.3"],
        ["pixelmatch", "4.0.2"],
        ["tinycolor2", "1.4.1"],
        ["@jimp/core", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/utils", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-utils-0.9.3-fd7af0d1138febbeacc841be4b802218444ce088-integrity/node_modules/@jimp/utils/"),
      packageDependencies: new Map([
        ["@babel/runtime", "7.8.3"],
        ["core-js", "3.6.4"],
        ["@jimp/utils", "0.9.3"],
      ]),
    }],
  ])],
  ["core-js", new Map([
    ["3.6.4", {
      packageLocation: path.resolve(__dirname, "./.pnp/unplugged/npm-core-js-3.6.4-440a83536b458114b9cb2ac1580ba377dc470647-integrity/node_modules/core-js/"),
      packageDependencies: new Map([
        ["core-js", "3.6.4"],
      ]),
    }],
  ])],
  ["any-base", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-any-base-1.1.0-ae101a62bc08a597b4c9ab5b7089d456630549fe-integrity/node_modules/any-base/"),
      packageDependencies: new Map([
        ["any-base", "1.1.0"],
      ]),
    }],
  ])],
  ["buffer", new Map([
    ["5.4.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-buffer-5.4.3-3fbc9c69eb713d323e3fc1a895eee0710c072115-integrity/node_modules/buffer/"),
      packageDependencies: new Map([
        ["base64-js", "1.3.1"],
        ["ieee754", "1.1.13"],
        ["buffer", "5.4.3"],
      ]),
    }],
  ])],
  ["base64-js", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-base64-js-1.3.1-58ece8cb75dd07e71ed08c736abc5fac4dbf8df1-integrity/node_modules/base64-js/"),
      packageDependencies: new Map([
        ["base64-js", "1.3.1"],
      ]),
    }],
  ])],
  ["ieee754", new Map([
    ["1.1.13", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ieee754-1.1.13-ec168558e95aa181fd87d37f55c32bbcb6708b84-integrity/node_modules/ieee754/"),
      packageDependencies: new Map([
        ["ieee754", "1.1.13"],
      ]),
    }],
  ])],
  ["exif-parser", new Map([
    ["0.1.12", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-exif-parser-0.1.12-58a9d2d72c02c1f6f02a0ef4a9166272b7760922-integrity/node_modules/exif-parser/"),
      packageDependencies: new Map([
        ["exif-parser", "0.1.12"],
      ]),
    }],
  ])],
  ["file-type", new Map([
    ["9.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-file-type-9.0.0-a68d5ad07f486414dfb2c8866f73161946714a18-integrity/node_modules/file-type/"),
      packageDependencies: new Map([
        ["file-type", "9.0.0"],
      ]),
    }],
  ])],
  ["load-bmfont", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-load-bmfont-1.4.0-75f17070b14a8c785fe7f5bee2e6fd4f98093b6b-integrity/node_modules/load-bmfont/"),
      packageDependencies: new Map([
        ["buffer-equal", "0.0.1"],
        ["mime", "1.6.0"],
        ["parse-bmfont-ascii", "1.0.6"],
        ["parse-bmfont-binary", "1.0.6"],
        ["parse-bmfont-xml", "1.1.4"],
        ["phin", "2.9.3"],
        ["xhr", "2.5.0"],
        ["xtend", "4.0.2"],
        ["load-bmfont", "1.4.0"],
      ]),
    }],
  ])],
  ["buffer-equal", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-buffer-equal-0.0.1-91bc74b11ea405bc916bc6aa908faafa5b4aac4b-integrity/node_modules/buffer-equal/"),
      packageDependencies: new Map([
        ["buffer-equal", "0.0.1"],
      ]),
    }],
  ])],
  ["mime", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mime-1.6.0-32cd9e5c64553bd58d19a568af452acff04981b1-integrity/node_modules/mime/"),
      packageDependencies: new Map([
        ["mime", "1.6.0"],
      ]),
    }],
  ])],
  ["parse-bmfont-ascii", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-parse-bmfont-ascii-1.0.6-11ac3c3ff58f7c2020ab22769079108d4dfa0285-integrity/node_modules/parse-bmfont-ascii/"),
      packageDependencies: new Map([
        ["parse-bmfont-ascii", "1.0.6"],
      ]),
    }],
  ])],
  ["parse-bmfont-binary", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-parse-bmfont-binary-1.0.6-d038b476d3e9dd9db1e11a0b0e53a22792b69006-integrity/node_modules/parse-bmfont-binary/"),
      packageDependencies: new Map([
        ["parse-bmfont-binary", "1.0.6"],
      ]),
    }],
  ])],
  ["parse-bmfont-xml", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-parse-bmfont-xml-1.1.4-015319797e3e12f9e739c4d513872cd2fa35f389-integrity/node_modules/parse-bmfont-xml/"),
      packageDependencies: new Map([
        ["xml-parse-from-string", "1.0.1"],
        ["xml2js", "0.4.23"],
        ["parse-bmfont-xml", "1.1.4"],
      ]),
    }],
  ])],
  ["xml-parse-from-string", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-xml-parse-from-string-1.0.1-a9029e929d3dbcded169f3c6e28238d95a5d5a28-integrity/node_modules/xml-parse-from-string/"),
      packageDependencies: new Map([
        ["xml-parse-from-string", "1.0.1"],
      ]),
    }],
  ])],
  ["xml2js", new Map([
    ["0.4.23", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-xml2js-0.4.23-a0c69516752421eb2ac758ee4d4ccf58843eac66-integrity/node_modules/xml2js/"),
      packageDependencies: new Map([
        ["sax", "1.2.4"],
        ["xmlbuilder", "11.0.1"],
        ["xml2js", "0.4.23"],
      ]),
    }],
  ])],
  ["xmlbuilder", new Map([
    ["11.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-xmlbuilder-11.0.1-be9bae1c8a046e76b31127726347d0ad7002beb3-integrity/node_modules/xmlbuilder/"),
      packageDependencies: new Map([
        ["xmlbuilder", "11.0.1"],
      ]),
    }],
  ])],
  ["phin", new Map([
    ["2.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-phin-2.9.3-f9b6ac10a035636fb65dfc576aaaa17b8743125c-integrity/node_modules/phin/"),
      packageDependencies: new Map([
        ["phin", "2.9.3"],
      ]),
    }],
  ])],
  ["xhr", new Map([
    ["2.5.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-xhr-2.5.0-bed8d1676d5ca36108667692b74b316c496e49dd-integrity/node_modules/xhr/"),
      packageDependencies: new Map([
        ["global", "4.3.2"],
        ["is-function", "1.0.1"],
        ["parse-headers", "2.0.3"],
        ["xtend", "4.0.2"],
        ["xhr", "2.5.0"],
      ]),
    }],
  ])],
  ["global", new Map([
    ["4.3.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-global-4.3.2-e76989268a6c74c38908b1305b10fc0e394e9d0f-integrity/node_modules/global/"),
      packageDependencies: new Map([
        ["min-document", "2.19.0"],
        ["process", "0.5.2"],
        ["global", "4.3.2"],
      ]),
    }],
  ])],
  ["min-document", new Map([
    ["2.19.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-min-document-2.19.0-7bd282e3f5842ed295bb748cdd9f1ffa2c824685-integrity/node_modules/min-document/"),
      packageDependencies: new Map([
        ["dom-walk", "0.1.1"],
        ["min-document", "2.19.0"],
      ]),
    }],
  ])],
  ["dom-walk", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-dom-walk-0.1.1-672226dc74c8f799ad35307df936aba11acd6018-integrity/node_modules/dom-walk/"),
      packageDependencies: new Map([
        ["dom-walk", "0.1.1"],
      ]),
    }],
  ])],
  ["process", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-process-0.5.2-1638d8a8e34c2f440a91db95ab9aeb677fc185cf-integrity/node_modules/process/"),
      packageDependencies: new Map([
        ["process", "0.5.2"],
      ]),
    }],
  ])],
  ["is-function", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-function-1.0.1-12cfb98b65b57dd3d193a3121f5f6e2f437602b5-integrity/node_modules/is-function/"),
      packageDependencies: new Map([
        ["is-function", "1.0.1"],
      ]),
    }],
  ])],
  ["parse-headers", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-parse-headers-2.0.3-5e8e7512383d140ba02f0c7aa9f49b4399c92515-integrity/node_modules/parse-headers/"),
      packageDependencies: new Map([
        ["parse-headers", "2.0.3"],
      ]),
    }],
  ])],
  ["xtend", new Map([
    ["4.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-xtend-4.0.2-bb72779f5fa465186b1f438f674fa347fdb5db54-integrity/node_modules/xtend/"),
      packageDependencies: new Map([
        ["xtend", "4.0.2"],
      ]),
    }],
  ])],
  ["pixelmatch", new Map([
    ["4.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-pixelmatch-4.0.2-8f47dcec5011b477b67db03c243bc1f3085e8854-integrity/node_modules/pixelmatch/"),
      packageDependencies: new Map([
        ["pngjs", "3.4.0"],
        ["pixelmatch", "4.0.2"],
      ]),
    }],
  ])],
  ["pngjs", new Map([
    ["3.4.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-pngjs-3.4.0-99ca7d725965fb655814eaf65f38f12bbdbf555f-integrity/node_modules/pngjs/"),
      packageDependencies: new Map([
        ["pngjs", "3.4.0"],
      ]),
    }],
  ])],
  ["tinycolor2", new Map([
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-tinycolor2-1.4.1-f4fad333447bc0b07d4dc8e9209d8f39a8ac77e8-integrity/node_modules/tinycolor2/"),
      packageDependencies: new Map([
        ["tinycolor2", "1.4.1"],
      ]),
    }],
  ])],
  ["@jimp/plugins", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugins-0.9.3-bdff9d49484469c4d74ef47c2708e75773ca22b9-integrity/node_modules/@jimp/plugins/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/plugin-blit", "0.9.3"],
        ["@jimp/plugin-blur", "0.9.3"],
        ["@jimp/plugin-color", "0.9.3"],
        ["@jimp/plugin-contain", "0.9.3"],
        ["@jimp/plugin-cover", "0.9.3"],
        ["@jimp/plugin-crop", "0.9.3"],
        ["@jimp/plugin-displace", "0.9.3"],
        ["@jimp/plugin-dither", "0.9.3"],
        ["@jimp/plugin-flip", "0.9.3"],
        ["@jimp/plugin-gaussian", "0.9.3"],
        ["@jimp/plugin-invert", "0.9.3"],
        ["@jimp/plugin-mask", "0.9.3"],
        ["@jimp/plugin-normalize", "0.9.3"],
        ["@jimp/plugin-print", "0.9.3"],
        ["@jimp/plugin-resize", "0.9.3"],
        ["@jimp/plugin-rotate", "0.9.3"],
        ["@jimp/plugin-scale", "0.9.3"],
        ["core-js", "3.6.4"],
        ["timm", "1.6.2"],
        ["@jimp/plugins", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-blit", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-blit-0.9.3-740346ac62ec0f7ae4458f5fd59c7582e630a8e8-integrity/node_modules/@jimp/plugin-blit/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-blit", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-blur", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-blur-0.9.3-9df505aaa63de138060264cf83ed4a98304bf105-integrity/node_modules/@jimp/plugin-blur/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-blur", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-color", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-color-0.9.3-4a5ad28f68901355878f5330186c260f4f87f944-integrity/node_modules/@jimp/plugin-color/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["tinycolor2", "1.4.1"],
        ["@jimp/plugin-color", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-contain", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-contain-0.9.3-d0da9892edea25549611c88e125bfcc59045c426-integrity/node_modules/@jimp/plugin-contain/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@jimp/plugin-blit", "0.9.3"],
        ["@jimp/plugin-resize", "0.9.3"],
        ["@jimp/plugin-scale", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-contain", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-cover", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-cover-0.9.3-2fca63620fcf8145bdecf315cf461588b09d9488-integrity/node_modules/@jimp/plugin-cover/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@jimp/plugin-crop", "0.9.3"],
        ["@jimp/plugin-resize", "0.9.3"],
        ["@jimp/plugin-scale", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-cover", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-crop", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-crop-0.9.3-9b19c11293714a99c03d4b517ab597a5f88823e8-integrity/node_modules/@jimp/plugin-crop/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-crop", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-displace", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-displace-0.9.3-07645687b29ebc8a8491244410172795d511ba21-integrity/node_modules/@jimp/plugin-displace/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-displace", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-dither", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-dither-0.9.3-292b3ee617a5dcfe065d13b643055e910f8b6934-integrity/node_modules/@jimp/plugin-dither/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-dither", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-flip", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-flip-0.9.3-a755ffa1d860106067215987cbac213501d22b41-integrity/node_modules/@jimp/plugin-flip/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@jimp/plugin-rotate", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-flip", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-gaussian", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-gaussian-0.9.3-b10b5a5b4c37cb4edc3ed22a9b25294e68daf2f8-integrity/node_modules/@jimp/plugin-gaussian/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-gaussian", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-invert", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-invert-0.9.3-723a873133a1d62f9b93e023991f262c85917c78-integrity/node_modules/@jimp/plugin-invert/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-invert", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-mask", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-mask-0.9.3-6329ec861269244ab10ab9b3f54b1624c4ce0bab-integrity/node_modules/@jimp/plugin-mask/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-mask", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-normalize", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-normalize-0.9.3-564155032d1b9dc567dbb7427a85606a25427c30-integrity/node_modules/@jimp/plugin-normalize/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-normalize", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-print", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-print-0.9.3-b4470137312232de9b35eaf412cd753f999c58d8-integrity/node_modules/@jimp/plugin-print/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@jimp/plugin-blit", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["load-bmfont", "1.4.0"],
        ["@jimp/plugin-print", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-resize", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-resize-0.9.3-916abd57c4f9b426984354c77555ade1efda7a82-integrity/node_modules/@jimp/plugin-resize/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-resize", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-rotate", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-rotate-0.9.3-aa0d674c08726c0ae3ebc7f2adbfca0a927b1d9f-integrity/node_modules/@jimp/plugin-rotate/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@jimp/plugin-blit", "0.9.3"],
        ["@jimp/plugin-crop", "0.9.3"],
        ["@jimp/plugin-resize", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-rotate", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/plugin-scale", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-plugin-scale-0.9.3-427fed7642883c27601aae33c25413980b6a2c50-integrity/node_modules/@jimp/plugin-scale/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@jimp/plugin-resize", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["@jimp/plugin-scale", "0.9.3"],
      ]),
    }],
  ])],
  ["timm", new Map([
    ["1.6.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-timm-1.6.2-dfd8c6719f7ba1fcfc6295a32670a1c6d166c0bd-integrity/node_modules/timm/"),
      packageDependencies: new Map([
        ["timm", "1.6.2"],
      ]),
    }],
  ])],
  ["@jimp/types", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-types-0.9.3-75337245a1a8c7c84a414beca3cfeded338c0ef1-integrity/node_modules/@jimp/types/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/bmp", "0.9.3"],
        ["@jimp/gif", "0.9.3"],
        ["@jimp/jpeg", "0.9.3"],
        ["@jimp/png", "0.9.3"],
        ["@jimp/tiff", "0.9.3"],
        ["core-js", "3.6.4"],
        ["timm", "1.6.2"],
        ["@jimp/types", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/bmp", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-bmp-0.9.3-98eafc81674ce750f428ac9380007f1a4e90255e-integrity/node_modules/@jimp/bmp/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["bmp-js", "0.1.0"],
        ["core-js", "3.6.4"],
        ["@jimp/bmp", "0.9.3"],
      ]),
    }],
  ])],
  ["bmp-js", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-bmp-js-0.1.0-e05a63f796a6c1ff25f4771ec7adadc148c07233-integrity/node_modules/bmp-js/"),
      packageDependencies: new Map([
        ["bmp-js", "0.1.0"],
      ]),
    }],
  ])],
  ["@jimp/gif", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-gif-0.9.3-b2b1a519092f94a913a955f252996f9a968930db-integrity/node_modules/@jimp/gif/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["omggif", "1.0.10"],
        ["@jimp/gif", "0.9.3"],
      ]),
    }],
  ])],
  ["omggif", new Map([
    ["1.0.10", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-omggif-1.0.10-ddaaf90d4a42f532e9e7cb3a95ecdd47f17c7b19-integrity/node_modules/omggif/"),
      packageDependencies: new Map([
        ["omggif", "1.0.10"],
      ]),
    }],
  ])],
  ["@jimp/jpeg", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-jpeg-0.9.3-a759cb3bccf3cb163166873b9bdc0c949c5991b5-integrity/node_modules/@jimp/jpeg/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["jpeg-js", "0.3.6"],
        ["@jimp/jpeg", "0.9.3"],
      ]),
    }],
  ])],
  ["jpeg-js", new Map([
    ["0.3.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-jpeg-js-0.3.6-c40382aac9506e7d1f2d856eb02f6c7b2a98b37c-integrity/node_modules/jpeg-js/"),
      packageDependencies: new Map([
        ["jpeg-js", "0.3.6"],
      ]),
    }],
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-jpeg-js-0.1.2-135b992c0575c985cfa0f494a3227ed238583ece-integrity/node_modules/jpeg-js/"),
      packageDependencies: new Map([
        ["jpeg-js", "0.1.2"],
      ]),
    }],
  ])],
  ["@jimp/png", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-png-0.9.3-5c1bbb89b32e2332891a13efdb423e87287a8321-integrity/node_modules/@jimp/png/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["@jimp/utils", "0.9.3"],
        ["core-js", "3.6.4"],
        ["pngjs", "3.4.0"],
        ["@jimp/png", "0.9.3"],
      ]),
    }],
  ])],
  ["@jimp/tiff", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@jimp-tiff-0.9.3-a4498c0616fb24034f5512b159b75b0aea389e9c-integrity/node_modules/@jimp/tiff/"),
      packageDependencies: new Map([
        ["@jimp/custom", "0.9.3"],
        ["@babel/runtime", "7.8.3"],
        ["core-js", "3.6.4"],
        ["utif", "2.0.1"],
        ["@jimp/tiff", "0.9.3"],
      ]),
    }],
  ])],
  ["utif", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-utif-2.0.1-9e1582d9bbd20011a6588548ed3266298e711759-integrity/node_modules/utif/"),
      packageDependencies: new Map([
        ["pako", "1.0.10"],
        ["utif", "2.0.1"],
      ]),
    }],
  ])],
  ["pako", new Map([
    ["1.0.10", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-pako-1.0.10-4328badb5086a426aa90f541977d4955da5c9732-integrity/node_modules/pako/"),
      packageDependencies: new Map([
        ["pako", "1.0.10"],
      ]),
    }],
  ])],
  ["js-yaml", new Map([
    ["3.13.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-js-yaml-3.13.1-aff151b30bfdfa8e49e05da22e7415e9dfa37847-integrity/node_modules/js-yaml/"),
      packageDependencies: new Map([
        ["argparse", "1.0.10"],
        ["esprima", "4.0.1"],
        ["js-yaml", "3.13.1"],
      ]),
    }],
  ])],
  ["argparse", new Map([
    ["1.0.10", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911-integrity/node_modules/argparse/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
        ["argparse", "1.0.10"],
      ]),
    }],
  ])],
  ["sprintf-js", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c-integrity/node_modules/sprintf-js/"),
      packageDependencies: new Map([
        ["sprintf-js", "1.0.3"],
      ]),
    }],
  ])],
  ["esprima", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71-integrity/node_modules/esprima/"),
      packageDependencies: new Map([
        ["esprima", "4.0.1"],
      ]),
    }],
  ])],
  ["mongoose", new Map([
    ["5.8.9", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mongoose-5.8.9-616ae9df4cd7f41f7d2d77d037ad94784485bd74-integrity/node_modules/mongoose/"),
      packageDependencies: new Map([
        ["bson", "1.1.3"],
        ["kareem", "2.3.1"],
        ["mongodb", "3.4.1"],
        ["mongoose-legacy-pluralize", "1.0.2"],
        ["mpath", "0.6.0"],
        ["mquery", "3.2.2"],
        ["ms", "2.1.2"],
        ["regexp-clone", "1.0.0"],
        ["safe-buffer", "5.1.2"],
        ["sift", "7.0.1"],
        ["sliced", "1.0.1"],
        ["mongoose", "5.8.9"],
      ]),
    }],
  ])],
  ["bson", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-bson-1.1.3-aa82cb91f9a453aaa060d6209d0675114a8154d3-integrity/node_modules/bson/"),
      packageDependencies: new Map([
        ["bson", "1.1.3"],
      ]),
    }],
  ])],
  ["kareem", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-kareem-2.3.1-def12d9c941017fabfb00f873af95e9c99e1be87-integrity/node_modules/kareem/"),
      packageDependencies: new Map([
        ["kareem", "2.3.1"],
      ]),
    }],
  ])],
  ["mongodb", new Map([
    ["3.4.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mongodb-3.4.1-0d15e57e0ea0fc85b7a4fb9291b374c2e71652dc-integrity/node_modules/mongodb/"),
      packageDependencies: new Map([
        ["bson", "1.1.3"],
        ["require_optional", "1.0.1"],
        ["safe-buffer", "5.2.0"],
        ["saslprep", "1.0.3"],
        ["mongodb", "3.4.1"],
      ]),
    }],
  ])],
  ["require_optional", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-require-optional-1.0.1-4cf35a4247f64ca3df8c2ef208cc494b1ca8fc2e-integrity/node_modules/require_optional/"),
      packageDependencies: new Map([
        ["resolve-from", "2.0.0"],
        ["semver", "5.7.1"],
        ["require_optional", "1.0.1"],
      ]),
    }],
  ])],
  ["resolve-from", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-resolve-from-2.0.0-9480ab20e94ffa1d9e80a804c7ea147611966b57-integrity/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "2.0.0"],
      ]),
    }],
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-resolve-from-4.0.0-4abcd852ad32dd7baabfe9b40e00a36db5f392e6-integrity/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "4.0.0"],
      ]),
    }],
  ])],
  ["saslprep", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-saslprep-1.0.3-4c02f946b56cf54297e347ba1093e7acac4cf226-integrity/node_modules/saslprep/"),
      packageDependencies: new Map([
        ["sparse-bitfield", "3.0.3"],
        ["saslprep", "1.0.3"],
      ]),
    }],
  ])],
  ["sparse-bitfield", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-sparse-bitfield-3.0.3-ff4ae6e68656056ba4b3e792ab3334d38273ca11-integrity/node_modules/sparse-bitfield/"),
      packageDependencies: new Map([
        ["memory-pager", "1.5.0"],
        ["sparse-bitfield", "3.0.3"],
      ]),
    }],
  ])],
  ["memory-pager", new Map([
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-memory-pager-1.5.0-d8751655d22d384682741c972f2c3d6dfa3e66b5-integrity/node_modules/memory-pager/"),
      packageDependencies: new Map([
        ["memory-pager", "1.5.0"],
      ]),
    }],
  ])],
  ["mongoose-legacy-pluralize", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mongoose-legacy-pluralize-1.0.2-3ba9f91fa507b5186d399fb40854bff18fb563e4-integrity/node_modules/mongoose-legacy-pluralize/"),
      packageDependencies: new Map([
        ["mongoose-legacy-pluralize", "1.0.2"],
      ]),
    }],
  ])],
  ["mpath", new Map([
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mpath-0.6.0-aa922029fca4f0f641f360e74c5c1b6a4c47078e-integrity/node_modules/mpath/"),
      packageDependencies: new Map([
        ["mpath", "0.6.0"],
      ]),
    }],
  ])],
  ["mquery", new Map([
    ["3.2.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mquery-3.2.2-e1383a3951852ce23e37f619a9b350f1fb3664e7-integrity/node_modules/mquery/"),
      packageDependencies: new Map([
        ["bluebird", "3.5.1"],
        ["debug", "3.1.0"],
        ["regexp-clone", "1.0.0"],
        ["safe-buffer", "5.1.2"],
        ["sliced", "1.0.1"],
        ["mquery", "3.2.2"],
      ]),
    }],
  ])],
  ["bluebird", new Map([
    ["3.5.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-bluebird-3.5.1-d9551f9de98f1fcda1e683d17ee91a0602ee2eb9-integrity/node_modules/bluebird/"),
      packageDependencies: new Map([
        ["bluebird", "3.5.1"],
      ]),
    }],
  ])],
  ["regexp-clone", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-regexp-clone-1.0.0-222db967623277056260b992626354a04ce9bf63-integrity/node_modules/regexp-clone/"),
      packageDependencies: new Map([
        ["regexp-clone", "1.0.0"],
      ]),
    }],
  ])],
  ["sliced", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-sliced-1.0.1-0b3a662b5d04c3177b1926bea82b03f837a2ef41-integrity/node_modules/sliced/"),
      packageDependencies: new Map([
        ["sliced", "1.0.1"],
      ]),
    }],
  ])],
  ["sift", new Map([
    ["7.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-sift-7.0.1-47d62c50b159d316f1372f8b53f9c10cd21a4b08-integrity/node_modules/sift/"),
      packageDependencies: new Map([
        ["sift", "7.0.1"],
      ]),
    }],
  ])],
  ["nanoid", new Map([
    ["2.1.9", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-nanoid-2.1.9-edc71de7b16fc367bbb447c7a638ccebe07a17a1-integrity/node_modules/nanoid/"),
      packageDependencies: new Map([
        ["nanoid", "2.1.9"],
      ]),
    }],
  ])],
  ["png-to-jpeg", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-png-to-jpeg-1.0.1-14362c6aaaec5ea6b52fa3504f5ecc760b4e7424-integrity/node_modules/png-to-jpeg/"),
      packageDependencies: new Map([
        ["jpeg-js", "0.1.2"],
        ["pify", "2.3.0"],
        ["png-js", "0.1.1"],
        ["png-to-jpeg", "1.0.1"],
      ]),
    }],
  ])],
  ["pify", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c-integrity/node_modules/pify/"),
      packageDependencies: new Map([
        ["pify", "2.3.0"],
      ]),
    }],
  ])],
  ["png-js", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-png-js-0.1.1-1cc7c212303acabe74263ec3ac78009580242d93-integrity/node_modules/png-js/"),
      packageDependencies: new Map([
        ["png-js", "0.1.1"],
      ]),
    }],
  ])],
  ["sharp", new Map([
    ["0.24.0", {
      packageLocation: path.resolve(__dirname, "./.pnp/unplugged/npm-sharp-0.24.0-1200f4bb36ccc2bb36a78f0bcba0302cf1f7a5fd-integrity/node_modules/sharp/"),
      packageDependencies: new Map([
        ["color", "3.1.2"],
        ["detect-libc", "1.0.3"],
        ["nan", "2.14.0"],
        ["npmlog", "4.1.2"],
        ["prebuild-install", "5.3.3"],
        ["semver", "7.1.1"],
        ["simple-get", "3.1.0"],
        ["tar", "5.0.5"],
        ["tunnel-agent", "0.6.0"],
        ["sharp", "0.24.0"],
      ]),
    }],
  ])],
  ["color", new Map([
    ["3.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-color-3.1.2-68148e7f85d41ad7649c5fa8c8106f098d229e10-integrity/node_modules/color/"),
      packageDependencies: new Map([
        ["color-convert", "1.9.3"],
        ["color-string", "1.5.3"],
        ["color", "3.1.2"],
      ]),
    }],
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-color-3.0.0-d920b4328d534a3ac8295d68f7bd4ba6c427be9a-integrity/node_modules/color/"),
      packageDependencies: new Map([
        ["color-convert", "1.9.3"],
        ["color-string", "1.5.3"],
        ["color", "3.0.0"],
      ]),
    }],
  ])],
  ["color-string", new Map([
    ["1.5.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-color-string-1.5.3-c9bbc5f01b58b5492f3d6857459cb6590ce204cc-integrity/node_modules/color-string/"),
      packageDependencies: new Map([
        ["color-name", "1.1.4"],
        ["simple-swizzle", "0.2.2"],
        ["color-string", "1.5.3"],
      ]),
    }],
  ])],
  ["simple-swizzle", new Map([
    ["0.2.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-simple-swizzle-0.2.2-a4da6b635ffcccca33f70d17cb92592de95e557a-integrity/node_modules/simple-swizzle/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.3.2"],
        ["simple-swizzle", "0.2.2"],
      ]),
    }],
  ])],
  ["is-arrayish", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-arrayish-0.3.2-4574a2ae56f7ab206896fb431eaeed066fdf8f03-integrity/node_modules/is-arrayish/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.3.2"],
      ]),
    }],
    ["0.2.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d-integrity/node_modules/is-arrayish/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
      ]),
    }],
  ])],
  ["prebuild-install", new Map([
    ["5.3.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-prebuild-install-5.3.3-ef4052baac60d465f5ba6bf003c9c1de79b9da8e-integrity/node_modules/prebuild-install/"),
      packageDependencies: new Map([
        ["detect-libc", "1.0.3"],
        ["expand-template", "2.0.3"],
        ["github-from-package", "0.0.0"],
        ["minimist", "1.2.0"],
        ["mkdirp", "0.5.1"],
        ["napi-build-utils", "1.0.1"],
        ["node-abi", "2.13.0"],
        ["noop-logger", "0.1.1"],
        ["npmlog", "4.1.2"],
        ["pump", "3.0.0"],
        ["rc", "1.2.8"],
        ["simple-get", "3.1.0"],
        ["tar-fs", "2.0.0"],
        ["tunnel-agent", "0.6.0"],
        ["which-pm-runs", "1.0.0"],
        ["prebuild-install", "5.3.3"],
      ]),
    }],
  ])],
  ["expand-template", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-expand-template-2.0.3-6e14b3fcee0f3a6340ecb57d2e8918692052a47c-integrity/node_modules/expand-template/"),
      packageDependencies: new Map([
        ["expand-template", "2.0.3"],
      ]),
    }],
  ])],
  ["github-from-package", new Map([
    ["0.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-github-from-package-0.0.0-97fb5d96bfde8973313f20e8288ef9a167fa64ce-integrity/node_modules/github-from-package/"),
      packageDependencies: new Map([
        ["github-from-package", "0.0.0"],
      ]),
    }],
  ])],
  ["napi-build-utils", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-napi-build-utils-1.0.1-1381a0f92c39d66bf19852e7873432fc2123e508-integrity/node_modules/napi-build-utils/"),
      packageDependencies: new Map([
        ["napi-build-utils", "1.0.1"],
      ]),
    }],
  ])],
  ["node-abi", new Map([
    ["2.13.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-node-abi-2.13.0-e2f2ec444d0aca3ea1b3874b6de41d1665828f63-integrity/node_modules/node-abi/"),
      packageDependencies: new Map([
        ["semver", "5.7.1"],
        ["node-abi", "2.13.0"],
      ]),
    }],
  ])],
  ["noop-logger", new Map([
    ["0.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-noop-logger-0.1.1-94a2b1633c4f1317553007d8966fd0e841b6a4c2-integrity/node_modules/noop-logger/"),
      packageDependencies: new Map([
        ["noop-logger", "0.1.1"],
      ]),
    }],
  ])],
  ["pump", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-pump-3.0.0-b4a2116815bde2f4e1ea602354e8c75565107a64-integrity/node_modules/pump/"),
      packageDependencies: new Map([
        ["end-of-stream", "1.4.4"],
        ["once", "1.4.0"],
        ["pump", "3.0.0"],
      ]),
    }],
  ])],
  ["end-of-stream", new Map([
    ["1.4.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-end-of-stream-1.4.4-5ae64a5f45057baf3626ec14da0ca5e4b2431eb0-integrity/node_modules/end-of-stream/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["end-of-stream", "1.4.4"],
      ]),
    }],
  ])],
  ["tar-fs", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-tar-fs-2.0.0-677700fc0c8b337a78bee3623fdc235f21d7afad-integrity/node_modules/tar-fs/"),
      packageDependencies: new Map([
        ["chownr", "1.1.3"],
        ["mkdirp", "0.5.1"],
        ["pump", "3.0.0"],
        ["tar-stream", "2.1.0"],
        ["tar-fs", "2.0.0"],
      ]),
    }],
  ])],
  ["tar-stream", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-tar-stream-2.1.0-d1aaa3661f05b38b5acc9b7020efdca5179a2cc3-integrity/node_modules/tar-stream/"),
      packageDependencies: new Map([
        ["bl", "3.0.0"],
        ["end-of-stream", "1.4.4"],
        ["fs-constants", "1.0.0"],
        ["inherits", "2.0.4"],
        ["readable-stream", "3.5.0"],
        ["tar-stream", "2.1.0"],
      ]),
    }],
  ])],
  ["bl", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-bl-3.0.0-3611ec00579fd18561754360b21e9f784500ff88-integrity/node_modules/bl/"),
      packageDependencies: new Map([
        ["readable-stream", "3.5.0"],
        ["bl", "3.0.0"],
      ]),
    }],
  ])],
  ["fs-constants", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-fs-constants-1.0.0-6be0de9be998ce16af8afc24497b9ee9b7ccd9ad-integrity/node_modules/fs-constants/"),
      packageDependencies: new Map([
        ["fs-constants", "1.0.0"],
      ]),
    }],
  ])],
  ["tunnel-agent", new Map([
    ["0.6.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-tunnel-agent-0.6.0-27a5dea06b36b04a0a9966774b290868f0fc40fd-integrity/node_modules/tunnel-agent/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.0"],
        ["tunnel-agent", "0.6.0"],
      ]),
    }],
  ])],
  ["which-pm-runs", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-which-pm-runs-1.0.0-670b3afbc552e0b55df6b7780ca74615f23ad1cb-integrity/node_modules/which-pm-runs/"),
      packageDependencies: new Map([
        ["which-pm-runs", "1.0.0"],
      ]),
    }],
  ])],
  ["telegraf", new Map([
    ["3.35.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-telegraf-3.35.0-edf454ef3239efa1b754c5cd24407d56863e586c-integrity/node_modules/telegraf/"),
      packageDependencies: new Map([
        ["@types/node", "13.1.8"],
        ["debug", "4.1.1"],
        ["minimist", "1.2.0"],
        ["module-alias", "2.2.2"],
        ["node-fetch", "2.6.0"],
        ["sandwich-stream", "2.0.2"],
        ["telegram-typings", "3.6.1"],
        ["telegraf", "3.35.0"],
      ]),
    }],
  ])],
  ["@types/node", new Map([
    ["13.1.8", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@types-node-13.1.8-1d590429fe8187a02707720ecf38a6fe46ce294b-integrity/node_modules/@types/node/"),
      packageDependencies: new Map([
        ["@types/node", "13.1.8"],
      ]),
    }],
  ])],
  ["module-alias", new Map([
    ["2.2.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-module-alias-2.2.2-151cdcecc24e25739ff0aa6e51e1c5716974c0e0-integrity/node_modules/module-alias/"),
      packageDependencies: new Map([
        ["module-alias", "2.2.2"],
      ]),
    }],
  ])],
  ["node-fetch", new Map([
    ["2.6.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-node-fetch-2.6.0-e633456386d4aa55863f676a7ab0daa8fdecb0fd-integrity/node_modules/node-fetch/"),
      packageDependencies: new Map([
        ["node-fetch", "2.6.0"],
      ]),
    }],
  ])],
  ["sandwich-stream", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-sandwich-stream-2.0.2-6d1feb6cf7e9fe9fadb41513459a72c2e84000fa-integrity/node_modules/sandwich-stream/"),
      packageDependencies: new Map([
        ["sandwich-stream", "2.0.2"],
      ]),
    }],
  ])],
  ["telegram-typings", new Map([
    ["3.6.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-telegram-typings-3.6.1-1288d547f8694b61f1c01c2993e295f3114d9e25-integrity/node_modules/telegram-typings/"),
      packageDependencies: new Map([
        ["telegram-typings", "3.6.1"],
      ]),
    }],
  ])],
  ["telegraf-i18n", new Map([
    ["6.6.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-telegraf-i18n-6.6.0-d75a5247bd4b6678f051b370871fca9488c61952-integrity/node_modules/telegraf-i18n/"),
      packageDependencies: new Map([
        ["telegraf", "3.35.0"],
        ["compile-template", "0.3.1"],
        ["debug", "4.1.1"],
        ["js-yaml", "3.13.1"],
        ["telegraf-i18n", "6.6.0"],
      ]),
    }],
  ])],
  ["compile-template", new Map([
    ["0.3.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-compile-template-0.3.1-e581a08385c792609408d448187a5eaaf334b6b0-integrity/node_modules/compile-template/"),
      packageDependencies: new Map([
        ["compile-template", "0.3.1"],
      ]),
    }],
  ])],
  ["telegraf-session-redis", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-telegraf-session-redis-5.1.0-f0eb6ff4f433ba97c4ea6d7717c8886b5d347ddb-integrity/node_modules/telegraf-session-redis/"),
      packageDependencies: new Map([
        ["telegraf", "3.35.0"],
        ["@types/redis", "2.8.14"],
        ["debug", "4.1.1"],
        ["redis", "2.8.0"],
        ["telegraf-session-redis", "5.1.0"],
      ]),
    }],
  ])],
  ["@types/redis", new Map([
    ["2.8.14", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@types-redis-2.8.14-2ed46d0f923f7ccd63fbe73a46a1241e606cf716-integrity/node_modules/@types/redis/"),
      packageDependencies: new Map([
        ["@types/node", "13.1.8"],
        ["@types/redis", "2.8.14"],
      ]),
    }],
  ])],
  ["redis", new Map([
    ["2.8.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-redis-2.8.0-202288e3f58c49f6079d97af7a10e1303ae14b02-integrity/node_modules/redis/"),
      packageDependencies: new Map([
        ["double-ended-queue", "2.1.0-0"],
        ["redis-commands", "1.5.0"],
        ["redis-parser", "2.6.0"],
        ["redis", "2.8.0"],
      ]),
    }],
  ])],
  ["double-ended-queue", new Map([
    ["2.1.0-0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-double-ended-queue-2.1.0-0-103d3527fd31528f40188130c841efdd78264e5c-integrity/node_modules/double-ended-queue/"),
      packageDependencies: new Map([
        ["double-ended-queue", "2.1.0-0"],
      ]),
    }],
  ])],
  ["redis-commands", new Map([
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-redis-commands-1.5.0-80d2e20698fe688f227127ff9e5164a7dd17e785-integrity/node_modules/redis-commands/"),
      packageDependencies: new Map([
        ["redis-commands", "1.5.0"],
      ]),
    }],
  ])],
  ["redis-parser", new Map([
    ["2.6.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-redis-parser-2.6.0-52ed09dacac108f1a631c07e9b69941e7a19504b-integrity/node_modules/redis-parser/"),
      packageDependencies: new Map([
        ["redis-parser", "2.6.0"],
      ]),
    }],
  ])],
  ["telegraph-uploader", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-telegraph-uploader-2.0.0-625d7af288c955564fa746ac47081186abd5173e-integrity/node_modules/telegraph-uploader/"),
      packageDependencies: new Map([
        ["form-data", "2.5.1"],
        ["is-buffer", "2.0.4"],
        ["isstream", "0.1.2"],
        ["node-fetch", "2.6.0"],
        ["stream-to-array", "2.3.0"],
        ["telegraph-uploader", "2.0.0"],
      ]),
    }],
  ])],
  ["form-data", new Map([
    ["2.5.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-form-data-2.5.1-f2cbec57b5e59e23716e128fe44d4e5dd23895f4-integrity/node_modules/form-data/"),
      packageDependencies: new Map([
        ["asynckit", "0.4.0"],
        ["combined-stream", "1.0.8"],
        ["mime-types", "2.1.26"],
        ["form-data", "2.5.1"],
      ]),
    }],
  ])],
  ["asynckit", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-asynckit-0.4.0-c79ed97f7f34cb8f2ba1bc9790bcc366474b4b79-integrity/node_modules/asynckit/"),
      packageDependencies: new Map([
        ["asynckit", "0.4.0"],
      ]),
    }],
  ])],
  ["combined-stream", new Map([
    ["1.0.8", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-combined-stream-1.0.8-c3d45a8b34fd730631a110a8a2520682b31d5a7f-integrity/node_modules/combined-stream/"),
      packageDependencies: new Map([
        ["delayed-stream", "1.0.0"],
        ["combined-stream", "1.0.8"],
      ]),
    }],
  ])],
  ["delayed-stream", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-delayed-stream-1.0.0-df3ae199acadfb7d440aaae0b29e2272b24ec619-integrity/node_modules/delayed-stream/"),
      packageDependencies: new Map([
        ["delayed-stream", "1.0.0"],
      ]),
    }],
  ])],
  ["mime-types", new Map([
    ["2.1.26", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mime-types-2.1.26-9c921fc09b7e149a65dfdc0da4d20997200b0a06-integrity/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-db", "1.43.0"],
        ["mime-types", "2.1.26"],
      ]),
    }],
  ])],
  ["mime-db", new Map([
    ["1.43.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mime-db-1.43.0-0a12e0502650e473d735535050e7c8f4eb4fae58-integrity/node_modules/mime-db/"),
      packageDependencies: new Map([
        ["mime-db", "1.43.0"],
      ]),
    }],
  ])],
  ["is-buffer", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-buffer-2.0.4-3e572f23c8411a5cfd9557c849e3665e0b290623-integrity/node_modules/is-buffer/"),
      packageDependencies: new Map([
        ["is-buffer", "2.0.4"],
      ]),
    }],
  ])],
  ["isstream", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-isstream-0.1.2-47e63f7af55afa6f92e1500e690eb8b8529c099a-integrity/node_modules/isstream/"),
      packageDependencies: new Map([
        ["isstream", "0.1.2"],
      ]),
    }],
  ])],
  ["stream-to-array", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-stream-to-array-2.3.0-bbf6b39f5f43ec30bc71babcb37557acecf34353-integrity/node_modules/stream-to-array/"),
      packageDependencies: new Map([
        ["any-promise", "1.3.0"],
        ["stream-to-array", "2.3.0"],
      ]),
    }],
  ])],
  ["any-promise", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-any-promise-1.3.0-abc6afeedcea52e809cdc0376aed3ce39635d17f-integrity/node_modules/any-promise/"),
      packageDependencies: new Map([
        ["any-promise", "1.3.0"],
      ]),
    }],
  ])],
  ["winston", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-winston-3.2.1-63061377976c73584028be2490a1846055f77f07-integrity/node_modules/winston/"),
      packageDependencies: new Map([
        ["async", "2.6.3"],
        ["diagnostics", "1.1.1"],
        ["is-stream", "1.1.0"],
        ["logform", "2.1.2"],
        ["one-time", "0.0.4"],
        ["readable-stream", "3.5.0"],
        ["stack-trace", "0.0.10"],
        ["triple-beam", "1.3.0"],
        ["winston-transport", "4.3.0"],
        ["winston", "3.2.1"],
      ]),
    }],
  ])],
  ["async", new Map([
    ["2.6.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-async-2.6.3-d72625e2344a3656e3a3ad4fa749fa83299d82ff-integrity/node_modules/async/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
        ["async", "2.6.3"],
      ]),
    }],
  ])],
  ["lodash", new Map([
    ["4.17.15", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548-integrity/node_modules/lodash/"),
      packageDependencies: new Map([
        ["lodash", "4.17.15"],
      ]),
    }],
  ])],
  ["diagnostics", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-diagnostics-1.1.1-cab6ac33df70c9d9a727490ae43ac995a769b22a-integrity/node_modules/diagnostics/"),
      packageDependencies: new Map([
        ["colorspace", "1.1.2"],
        ["enabled", "1.0.2"],
        ["kuler", "1.0.1"],
        ["diagnostics", "1.1.1"],
      ]),
    }],
  ])],
  ["colorspace", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-colorspace-1.1.2-e0128950d082b86a2168580796a0aa5d6c68d8c5-integrity/node_modules/colorspace/"),
      packageDependencies: new Map([
        ["color", "3.0.0"],
        ["text-hex", "1.0.0"],
        ["colorspace", "1.1.2"],
      ]),
    }],
  ])],
  ["text-hex", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-text-hex-1.0.0-69dc9c1b17446ee79a92bf5b884bb4b9127506f5-integrity/node_modules/text-hex/"),
      packageDependencies: new Map([
        ["text-hex", "1.0.0"],
      ]),
    }],
  ])],
  ["enabled", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-enabled-1.0.2-965f6513d2c2d1c5f4652b64a2e3396467fc2f93-integrity/node_modules/enabled/"),
      packageDependencies: new Map([
        ["env-variable", "0.0.5"],
        ["enabled", "1.0.2"],
      ]),
    }],
  ])],
  ["env-variable", new Map([
    ["0.0.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-env-variable-0.0.5-913dd830bef11e96a039c038d4130604eba37f88-integrity/node_modules/env-variable/"),
      packageDependencies: new Map([
        ["env-variable", "0.0.5"],
      ]),
    }],
  ])],
  ["kuler", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-kuler-1.0.1-ef7c784f36c9fb6e16dd3150d152677b2b0228a6-integrity/node_modules/kuler/"),
      packageDependencies: new Map([
        ["colornames", "1.1.1"],
        ["kuler", "1.0.1"],
      ]),
    }],
  ])],
  ["colornames", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-colornames-1.1.1-f8889030685c7c4ff9e2a559f5077eb76a816f96-integrity/node_modules/colornames/"),
      packageDependencies: new Map([
        ["colornames", "1.1.1"],
      ]),
    }],
  ])],
  ["is-stream", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-stream-1.1.0-12d4a3dd4e68e0b79ceb8dbc84173ae80d91ca44-integrity/node_modules/is-stream/"),
      packageDependencies: new Map([
        ["is-stream", "1.1.0"],
      ]),
    }],
  ])],
  ["logform", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-logform-2.1.2-957155ebeb67a13164069825ce67ddb5bb2dd360-integrity/node_modules/logform/"),
      packageDependencies: new Map([
        ["colors", "1.4.0"],
        ["fast-safe-stringify", "2.0.7"],
        ["fecha", "2.3.3"],
        ["ms", "2.1.2"],
        ["triple-beam", "1.3.0"],
        ["logform", "2.1.2"],
      ]),
    }],
  ])],
  ["colors", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-colors-1.4.0-c50491479d4c1bdaed2c9ced32cf7c7dc2360f78-integrity/node_modules/colors/"),
      packageDependencies: new Map([
        ["colors", "1.4.0"],
      ]),
    }],
  ])],
  ["fast-safe-stringify", new Map([
    ["2.0.7", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-fast-safe-stringify-2.0.7-124aa885899261f68aedb42a7c080de9da608743-integrity/node_modules/fast-safe-stringify/"),
      packageDependencies: new Map([
        ["fast-safe-stringify", "2.0.7"],
      ]),
    }],
  ])],
  ["fecha", new Map([
    ["2.3.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-fecha-2.3.3-948e74157df1a32fd1b12c3a3c3cdcb6ec9d96cd-integrity/node_modules/fecha/"),
      packageDependencies: new Map([
        ["fecha", "2.3.3"],
      ]),
    }],
  ])],
  ["triple-beam", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-triple-beam-1.3.0-a595214c7298db8339eeeee083e4d10bd8cb8dd9-integrity/node_modules/triple-beam/"),
      packageDependencies: new Map([
        ["triple-beam", "1.3.0"],
      ]),
    }],
  ])],
  ["one-time", new Map([
    ["0.0.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-one-time-0.0.4-f8cdf77884826fe4dff93e3a9cc37b1e4480742e-integrity/node_modules/one-time/"),
      packageDependencies: new Map([
        ["one-time", "0.0.4"],
      ]),
    }],
  ])],
  ["stack-trace", new Map([
    ["0.0.10", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-stack-trace-0.0.10-547c70b347e8d32b4e108ea1a2a159e5fdde19c0-integrity/node_modules/stack-trace/"),
      packageDependencies: new Map([
        ["stack-trace", "0.0.10"],
      ]),
    }],
  ])],
  ["winston-transport", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-winston-transport-4.3.0-df68c0c202482c448d9b47313c07304c2d7c2c66-integrity/node_modules/winston-transport/"),
      packageDependencies: new Map([
        ["readable-stream", "2.3.7"],
        ["triple-beam", "1.3.0"],
        ["winston-transport", "4.3.0"],
      ]),
    }],
  ])],
  ["eslint", new Map([
    ["6.8.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-6.8.0-62262d6729739f9275723824302fb227c8c93ffb-integrity/node_modules/eslint/"),
      packageDependencies: new Map([
        ["@babel/code-frame", "7.8.3"],
        ["ajv", "6.11.0"],
        ["chalk", "2.4.2"],
        ["cross-spawn", "6.0.5"],
        ["debug", "4.1.1"],
        ["doctrine", "3.0.0"],
        ["eslint-scope", "5.0.0"],
        ["eslint-utils", "1.4.3"],
        ["eslint-visitor-keys", "1.1.0"],
        ["espree", "6.1.2"],
        ["esquery", "1.0.1"],
        ["esutils", "2.0.3"],
        ["file-entry-cache", "5.0.1"],
        ["functional-red-black-tree", "1.0.1"],
        ["glob-parent", "5.1.0"],
        ["globals", "12.3.0"],
        ["ignore", "4.0.6"],
        ["import-fresh", "3.2.1"],
        ["imurmurhash", "0.1.4"],
        ["inquirer", "7.0.3"],
        ["is-glob", "4.0.1"],
        ["js-yaml", "3.13.1"],
        ["json-stable-stringify-without-jsonify", "1.0.1"],
        ["levn", "0.3.0"],
        ["lodash", "4.17.15"],
        ["minimatch", "3.0.4"],
        ["mkdirp", "0.5.1"],
        ["natural-compare", "1.4.0"],
        ["optionator", "0.8.3"],
        ["progress", "2.0.3"],
        ["regexpp", "2.0.1"],
        ["semver", "6.3.0"],
        ["strip-ansi", "5.2.0"],
        ["strip-json-comments", "3.0.1"],
        ["table", "5.4.6"],
        ["text-table", "0.2.0"],
        ["v8-compile-cache", "2.1.0"],
        ["eslint", "6.8.0"],
      ]),
    }],
  ])],
  ["@babel/code-frame", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@babel-code-frame-7.8.3-33e25903d7481181534e12ec0a25f16b6fcf419e-integrity/node_modules/@babel/code-frame/"),
      packageDependencies: new Map([
        ["@babel/highlight", "7.8.3"],
        ["@babel/code-frame", "7.8.3"],
      ]),
    }],
  ])],
  ["@babel/highlight", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-@babel-highlight-7.8.3-28f173d04223eaaa59bc1d439a3836e6d1265797-integrity/node_modules/@babel/highlight/"),
      packageDependencies: new Map([
        ["chalk", "2.4.2"],
        ["esutils", "2.0.3"],
        ["js-tokens", "4.0.0"],
        ["@babel/highlight", "7.8.3"],
      ]),
    }],
  ])],
  ["esutils", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64-integrity/node_modules/esutils/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
      ]),
    }],
  ])],
  ["js-tokens", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499-integrity/node_modules/js-tokens/"),
      packageDependencies: new Map([
        ["js-tokens", "4.0.0"],
      ]),
    }],
  ])],
  ["ajv", new Map([
    ["6.11.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ajv-6.11.0-c3607cbc8ae392d8a5a536f25b21f8e5f3f87fe9-integrity/node_modules/ajv/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "3.1.1"],
        ["fast-json-stable-stringify", "2.1.0"],
        ["json-schema-traverse", "0.4.1"],
        ["uri-js", "4.2.2"],
        ["ajv", "6.11.0"],
      ]),
    }],
  ])],
  ["fast-deep-equal", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-fast-deep-equal-3.1.1-545145077c501491e33b15ec408c294376e94ae4-integrity/node_modules/fast-deep-equal/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "3.1.1"],
      ]),
    }],
  ])],
  ["fast-json-stable-stringify", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-fast-json-stable-stringify-2.1.0-874bf69c6f404c2b5d99c481341399fd55892633-integrity/node_modules/fast-json-stable-stringify/"),
      packageDependencies: new Map([
        ["fast-json-stable-stringify", "2.1.0"],
      ]),
    }],
  ])],
  ["json-schema-traverse", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660-integrity/node_modules/json-schema-traverse/"),
      packageDependencies: new Map([
        ["json-schema-traverse", "0.4.1"],
      ]),
    }],
  ])],
  ["uri-js", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-uri-js-4.2.2-94c540e1ff772956e2299507c010aea6c8838eb0-integrity/node_modules/uri-js/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
        ["uri-js", "4.2.2"],
      ]),
    }],
  ])],
  ["punycode", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec-integrity/node_modules/punycode/"),
      packageDependencies: new Map([
        ["punycode", "2.1.1"],
      ]),
    }],
  ])],
  ["cross-spawn", new Map([
    ["6.0.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4-integrity/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
        ["path-key", "2.0.1"],
        ["semver", "5.7.1"],
        ["shebang-command", "1.2.0"],
        ["which", "1.3.1"],
        ["cross-spawn", "6.0.5"],
      ]),
    }],
  ])],
  ["nice-try", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366-integrity/node_modules/nice-try/"),
      packageDependencies: new Map([
        ["nice-try", "1.0.5"],
      ]),
    }],
  ])],
  ["path-key", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40-integrity/node_modules/path-key/"),
      packageDependencies: new Map([
        ["path-key", "2.0.1"],
      ]),
    }],
  ])],
  ["shebang-command", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea-integrity/node_modules/shebang-command/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
        ["shebang-command", "1.2.0"],
      ]),
    }],
  ])],
  ["shebang-regex", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3-integrity/node_modules/shebang-regex/"),
      packageDependencies: new Map([
        ["shebang-regex", "1.0.0"],
      ]),
    }],
  ])],
  ["which", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a-integrity/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "1.3.1"],
      ]),
    }],
  ])],
  ["isexe", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10-integrity/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
      ]),
    }],
  ])],
  ["doctrine", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-doctrine-3.0.0-addebead72a6574db783639dc87a121773973961-integrity/node_modules/doctrine/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
        ["doctrine", "3.0.0"],
      ]),
    }],
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-doctrine-1.5.0-379dce730f6166f76cefa4e6707a159b02c5a6fa-integrity/node_modules/doctrine/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
        ["isarray", "1.0.0"],
        ["doctrine", "1.5.0"],
      ]),
    }],
  ])],
  ["eslint-scope", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-scope-5.0.0-e87c8887c73e8d1ec84f1ca591645c358bfc8fb9-integrity/node_modules/eslint-scope/"),
      packageDependencies: new Map([
        ["esrecurse", "4.2.1"],
        ["estraverse", "4.3.0"],
        ["eslint-scope", "5.0.0"],
      ]),
    }],
  ])],
  ["esrecurse", new Map([
    ["4.2.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-esrecurse-4.2.1-007a3b9fdbc2b3bb87e4879ea19c92fdbd3942cf-integrity/node_modules/esrecurse/"),
      packageDependencies: new Map([
        ["estraverse", "4.3.0"],
        ["esrecurse", "4.2.1"],
      ]),
    }],
  ])],
  ["estraverse", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d-integrity/node_modules/estraverse/"),
      packageDependencies: new Map([
        ["estraverse", "4.3.0"],
      ]),
    }],
  ])],
  ["eslint-utils", new Map([
    ["1.4.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-utils-1.4.3-74fec7c54d0776b6f67e0251040b5806564e981f-integrity/node_modules/eslint-utils/"),
      packageDependencies: new Map([
        ["eslint-visitor-keys", "1.1.0"],
        ["eslint-utils", "1.4.3"],
      ]),
    }],
  ])],
  ["eslint-visitor-keys", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-visitor-keys-1.1.0-e2a82cea84ff246ad6fb57f9bde5b46621459ec2-integrity/node_modules/eslint-visitor-keys/"),
      packageDependencies: new Map([
        ["eslint-visitor-keys", "1.1.0"],
      ]),
    }],
  ])],
  ["espree", new Map([
    ["6.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-espree-6.1.2-6c272650932b4f91c3714e5e7b5f5e2ecf47262d-integrity/node_modules/espree/"),
      packageDependencies: new Map([
        ["acorn", "7.1.0"],
        ["acorn-jsx", "5.1.0"],
        ["eslint-visitor-keys", "1.1.0"],
        ["espree", "6.1.2"],
      ]),
    }],
  ])],
  ["acorn", new Map([
    ["7.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-acorn-7.1.0-949d36f2c292535da602283586c2477c57eb2d6c-integrity/node_modules/acorn/"),
      packageDependencies: new Map([
        ["acorn", "7.1.0"],
      ]),
    }],
  ])],
  ["acorn-jsx", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-acorn-jsx-5.1.0-294adb71b57398b0680015f0a38c563ee1db5384-integrity/node_modules/acorn-jsx/"),
      packageDependencies: new Map([
        ["acorn", "7.1.0"],
        ["acorn-jsx", "5.1.0"],
      ]),
    }],
  ])],
  ["esquery", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-esquery-1.0.1-406c51658b1f5991a5f9b62b1dc25b00e3e5c708-integrity/node_modules/esquery/"),
      packageDependencies: new Map([
        ["estraverse", "4.3.0"],
        ["esquery", "1.0.1"],
      ]),
    }],
  ])],
  ["file-entry-cache", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-file-entry-cache-5.0.1-ca0f6efa6dd3d561333fb14515065c2fafdf439c-integrity/node_modules/file-entry-cache/"),
      packageDependencies: new Map([
        ["flat-cache", "2.0.1"],
        ["file-entry-cache", "5.0.1"],
      ]),
    }],
  ])],
  ["flat-cache", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-flat-cache-2.0.1-5d296d6f04bda44a4630a301413bdbc2ec085ec0-integrity/node_modules/flat-cache/"),
      packageDependencies: new Map([
        ["flatted", "2.0.1"],
        ["rimraf", "2.6.3"],
        ["write", "1.0.3"],
        ["flat-cache", "2.0.1"],
      ]),
    }],
  ])],
  ["flatted", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-flatted-2.0.1-69e57caa8f0eacbc281d2e2cb458d46fdb449e08-integrity/node_modules/flatted/"),
      packageDependencies: new Map([
        ["flatted", "2.0.1"],
      ]),
    }],
  ])],
  ["write", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-write-1.0.3-0800e14523b923a387e415123c865616aae0f5c3-integrity/node_modules/write/"),
      packageDependencies: new Map([
        ["mkdirp", "0.5.1"],
        ["write", "1.0.3"],
      ]),
    }],
  ])],
  ["functional-red-black-tree", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-functional-red-black-tree-1.0.1-1b0ab3bd553b2a0d6399d29c0e3ea0b252078327-integrity/node_modules/functional-red-black-tree/"),
      packageDependencies: new Map([
        ["functional-red-black-tree", "1.0.1"],
      ]),
    }],
  ])],
  ["glob-parent", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-glob-parent-5.1.0-5f4c1d1e748d30cd73ad2944b3577a81b081e8c2-integrity/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "4.0.1"],
        ["glob-parent", "5.1.0"],
      ]),
    }],
  ])],
  ["is-glob", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-glob-4.0.1-7567dbe9f2f5e2467bc77ab83c4a29482407a5dc-integrity/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "4.0.1"],
      ]),
    }],
  ])],
  ["is-extglob", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2-integrity/node_modules/is-extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
      ]),
    }],
  ])],
  ["globals", new Map([
    ["12.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-globals-12.3.0-1e564ee5c4dded2ab098b0f88f24702a3c56be13-integrity/node_modules/globals/"),
      packageDependencies: new Map([
        ["type-fest", "0.8.1"],
        ["globals", "12.3.0"],
      ]),
    }],
  ])],
  ["type-fest", new Map([
    ["0.8.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-type-fest-0.8.1-09e249ebde851d3b1e48d27c105444667f17b83d-integrity/node_modules/type-fest/"),
      packageDependencies: new Map([
        ["type-fest", "0.8.1"],
      ]),
    }],
  ])],
  ["ignore", new Map([
    ["4.0.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ignore-4.0.6-750e3db5862087b4737ebac8207ffd1ef27b25fc-integrity/node_modules/ignore/"),
      packageDependencies: new Map([
        ["ignore", "4.0.6"],
      ]),
    }],
  ])],
  ["import-fresh", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-import-fresh-3.2.1-633ff618506e793af5ac91bf48b72677e15cbe66-integrity/node_modules/import-fresh/"),
      packageDependencies: new Map([
        ["parent-module", "1.0.1"],
        ["resolve-from", "4.0.0"],
        ["import-fresh", "3.2.1"],
      ]),
    }],
  ])],
  ["parent-module", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-parent-module-1.0.1-691d2709e78c79fae3a156622452d00762caaaa2-integrity/node_modules/parent-module/"),
      packageDependencies: new Map([
        ["callsites", "3.1.0"],
        ["parent-module", "1.0.1"],
      ]),
    }],
  ])],
  ["callsites", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-callsites-3.1.0-b3630abd8943432f54b3f0519238e33cd7df2f73-integrity/node_modules/callsites/"),
      packageDependencies: new Map([
        ["callsites", "3.1.0"],
      ]),
    }],
  ])],
  ["imurmurhash", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea-integrity/node_modules/imurmurhash/"),
      packageDependencies: new Map([
        ["imurmurhash", "0.1.4"],
      ]),
    }],
  ])],
  ["inquirer", new Map([
    ["7.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-inquirer-7.0.3-f9b4cd2dff58b9f73e8d43759436ace15bed4567-integrity/node_modules/inquirer/"),
      packageDependencies: new Map([
        ["ansi-escapes", "4.3.0"],
        ["chalk", "2.4.2"],
        ["cli-cursor", "3.1.0"],
        ["cli-width", "2.2.0"],
        ["external-editor", "3.1.0"],
        ["figures", "3.1.0"],
        ["lodash", "4.17.15"],
        ["mute-stream", "0.0.8"],
        ["run-async", "2.3.0"],
        ["rxjs", "6.5.4"],
        ["string-width", "4.2.0"],
        ["strip-ansi", "5.2.0"],
        ["through", "2.3.8"],
        ["inquirer", "7.0.3"],
      ]),
    }],
  ])],
  ["ansi-escapes", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-ansi-escapes-4.3.0-a4ce2b33d6b214b7950d8595c212f12ac9cc569d-integrity/node_modules/ansi-escapes/"),
      packageDependencies: new Map([
        ["type-fest", "0.8.1"],
        ["ansi-escapes", "4.3.0"],
      ]),
    }],
  ])],
  ["cli-cursor", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-cli-cursor-3.1.0-264305a7ae490d1d03bf0c9ba7c925d1753af307-integrity/node_modules/cli-cursor/"),
      packageDependencies: new Map([
        ["restore-cursor", "3.1.0"],
        ["cli-cursor", "3.1.0"],
      ]),
    }],
  ])],
  ["restore-cursor", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-restore-cursor-3.1.0-39f67c54b3a7a58cea5236d95cf0034239631f7e-integrity/node_modules/restore-cursor/"),
      packageDependencies: new Map([
        ["onetime", "5.1.0"],
        ["signal-exit", "3.0.2"],
        ["restore-cursor", "3.1.0"],
      ]),
    }],
  ])],
  ["onetime", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-onetime-5.1.0-fff0f3c91617fe62bb50189636e99ac8a6df7be5-integrity/node_modules/onetime/"),
      packageDependencies: new Map([
        ["mimic-fn", "2.1.0"],
        ["onetime", "5.1.0"],
      ]),
    }],
  ])],
  ["mimic-fn", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mimic-fn-2.1.0-7ed2c2ccccaf84d3ffcb7a69b57711fc2083401b-integrity/node_modules/mimic-fn/"),
      packageDependencies: new Map([
        ["mimic-fn", "2.1.0"],
      ]),
    }],
  ])],
  ["cli-width", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-cli-width-2.2.0-ff19ede8a9a5e579324147b0c11f0fbcbabed639-integrity/node_modules/cli-width/"),
      packageDependencies: new Map([
        ["cli-width", "2.2.0"],
      ]),
    }],
  ])],
  ["external-editor", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-external-editor-3.1.0-cb03f740befae03ea4d283caed2741a83f335495-integrity/node_modules/external-editor/"),
      packageDependencies: new Map([
        ["chardet", "0.7.0"],
        ["iconv-lite", "0.4.24"],
        ["tmp", "0.0.33"],
        ["external-editor", "3.1.0"],
      ]),
    }],
  ])],
  ["chardet", new Map([
    ["0.7.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-chardet-0.7.0-90094849f0937f2eedc2425d0d28a9e5f0cbad9e-integrity/node_modules/chardet/"),
      packageDependencies: new Map([
        ["chardet", "0.7.0"],
      ]),
    }],
  ])],
  ["tmp", new Map([
    ["0.0.33", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-tmp-0.0.33-6d34335889768d21b2bcda0aa277ced3b1bfadf9-integrity/node_modules/tmp/"),
      packageDependencies: new Map([
        ["os-tmpdir", "1.0.2"],
        ["tmp", "0.0.33"],
      ]),
    }],
  ])],
  ["figures", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-figures-3.1.0-4b198dd07d8d71530642864af2d45dd9e459c4ec-integrity/node_modules/figures/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
        ["figures", "3.1.0"],
      ]),
    }],
  ])],
  ["mute-stream", new Map([
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-mute-stream-0.0.8-1630c42b2251ff81e2a283de96a5497ea92e5e0d-integrity/node_modules/mute-stream/"),
      packageDependencies: new Map([
        ["mute-stream", "0.0.8"],
      ]),
    }],
  ])],
  ["run-async", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-run-async-2.3.0-0371ab4ae0bdd720d4166d7dfda64ff7a445a6c0-integrity/node_modules/run-async/"),
      packageDependencies: new Map([
        ["is-promise", "2.1.0"],
        ["run-async", "2.3.0"],
      ]),
    }],
  ])],
  ["is-promise", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-promise-2.1.0-79a2a9ece7f096e80f36d2b2f3bc16c1ff4bf3fa-integrity/node_modules/is-promise/"),
      packageDependencies: new Map([
        ["is-promise", "2.1.0"],
      ]),
    }],
  ])],
  ["rxjs", new Map([
    ["6.5.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-rxjs-6.5.4-e0777fe0d184cec7872df147f303572d414e211c-integrity/node_modules/rxjs/"),
      packageDependencies: new Map([
        ["tslib", "1.10.0"],
        ["rxjs", "6.5.4"],
      ]),
    }],
  ])],
  ["tslib", new Map([
    ["1.10.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-tslib-1.10.0-c3c19f95973fb0a62973fb09d90d961ee43e5c8a-integrity/node_modules/tslib/"),
      packageDependencies: new Map([
        ["tslib", "1.10.0"],
      ]),
    }],
  ])],
  ["emoji-regex", new Map([
    ["8.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-emoji-regex-8.0.0-e818fd69ce5ccfcb404594f842963bf53164cc37-integrity/node_modules/emoji-regex/"),
      packageDependencies: new Map([
        ["emoji-regex", "8.0.0"],
      ]),
    }],
    ["7.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-emoji-regex-7.0.3-933a04052860c85e83c122479c4748a8e4c72156-integrity/node_modules/emoji-regex/"),
      packageDependencies: new Map([
        ["emoji-regex", "7.0.3"],
      ]),
    }],
  ])],
  ["through", new Map([
    ["2.3.8", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-through-2.3.8-0dd4c9ffaabc357960b1b724115d7e0e86a2e1f5-integrity/node_modules/through/"),
      packageDependencies: new Map([
        ["through", "2.3.8"],
      ]),
    }],
  ])],
  ["json-stable-stringify-without-jsonify", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-json-stable-stringify-without-jsonify-1.0.1-9db7b59496ad3f3cfef30a75142d2d930ad72651-integrity/node_modules/json-stable-stringify-without-jsonify/"),
      packageDependencies: new Map([
        ["json-stable-stringify-without-jsonify", "1.0.1"],
      ]),
    }],
  ])],
  ["levn", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-levn-0.3.0-3b09924edf9f083c0490fdd4c0bc4421e04764ee-integrity/node_modules/levn/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
        ["levn", "0.3.0"],
      ]),
    }],
  ])],
  ["prelude-ls", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-prelude-ls-1.1.2-21932a549f5e52ffd9a827f570e04be62a97da54-integrity/node_modules/prelude-ls/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
      ]),
    }],
  ])],
  ["type-check", new Map([
    ["0.3.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-type-check-0.3.2-5884cab512cf1d355e3fb784f30804b2b520db72-integrity/node_modules/type-check/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
      ]),
    }],
  ])],
  ["natural-compare", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-natural-compare-1.4.0-4abebfeed7541f2c27acfb29bdbbd15c8d5ba4f7-integrity/node_modules/natural-compare/"),
      packageDependencies: new Map([
        ["natural-compare", "1.4.0"],
      ]),
    }],
  ])],
  ["optionator", new Map([
    ["0.8.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-optionator-0.8.3-84fa1d036fe9d3c7e21d99884b601167ec8fb495-integrity/node_modules/optionator/"),
      packageDependencies: new Map([
        ["deep-is", "0.1.3"],
        ["fast-levenshtein", "2.0.6"],
        ["levn", "0.3.0"],
        ["prelude-ls", "1.1.2"],
        ["type-check", "0.3.2"],
        ["word-wrap", "1.2.3"],
        ["optionator", "0.8.3"],
      ]),
    }],
  ])],
  ["deep-is", new Map([
    ["0.1.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-deep-is-0.1.3-b369d6fb5dbc13eecf524f91b070feedc357cf34-integrity/node_modules/deep-is/"),
      packageDependencies: new Map([
        ["deep-is", "0.1.3"],
      ]),
    }],
  ])],
  ["fast-levenshtein", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917-integrity/node_modules/fast-levenshtein/"),
      packageDependencies: new Map([
        ["fast-levenshtein", "2.0.6"],
      ]),
    }],
  ])],
  ["word-wrap", new Map([
    ["1.2.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-word-wrap-1.2.3-610636f6b1f703891bd34771ccb17fb93b47079c-integrity/node_modules/word-wrap/"),
      packageDependencies: new Map([
        ["word-wrap", "1.2.3"],
      ]),
    }],
  ])],
  ["progress", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-progress-2.0.3-7e8cf8d8f5b8f239c1bc68beb4eb78567d572ef8-integrity/node_modules/progress/"),
      packageDependencies: new Map([
        ["progress", "2.0.3"],
      ]),
    }],
  ])],
  ["regexpp", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-regexpp-2.0.1-8d19d31cf632482b589049f8281f93dbcba4d07f-integrity/node_modules/regexpp/"),
      packageDependencies: new Map([
        ["regexpp", "2.0.1"],
      ]),
    }],
  ])],
  ["table", new Map([
    ["5.4.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-table-5.4.6-1292d19500ce3f86053b05f0e8e7e4a3bb21079e-integrity/node_modules/table/"),
      packageDependencies: new Map([
        ["ajv", "6.11.0"],
        ["lodash", "4.17.15"],
        ["slice-ansi", "2.1.0"],
        ["string-width", "3.1.0"],
        ["table", "5.4.6"],
      ]),
    }],
  ])],
  ["slice-ansi", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-slice-ansi-2.1.0-cacd7693461a637a5788d92a7dd4fba068e81636-integrity/node_modules/slice-ansi/"),
      packageDependencies: new Map([
        ["ansi-styles", "3.2.1"],
        ["astral-regex", "1.0.0"],
        ["is-fullwidth-code-point", "2.0.0"],
        ["slice-ansi", "2.1.0"],
      ]),
    }],
  ])],
  ["astral-regex", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-astral-regex-1.0.0-6c8c3fb827dd43ee3918f27b82782ab7658a6fd9-integrity/node_modules/astral-regex/"),
      packageDependencies: new Map([
        ["astral-regex", "1.0.0"],
      ]),
    }],
  ])],
  ["text-table", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-text-table-0.2.0-7f5ee823ae805207c00af2df4a84ec3fcfa570b4-integrity/node_modules/text-table/"),
      packageDependencies: new Map([
        ["text-table", "0.2.0"],
      ]),
    }],
  ])],
  ["v8-compile-cache", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-v8-compile-cache-2.1.0-e14de37b31a6d194f5690d67efc4e7f6fc6ab30e-integrity/node_modules/v8-compile-cache/"),
      packageDependencies: new Map([
        ["v8-compile-cache", "2.1.0"],
      ]),
    }],
  ])],
  ["eslint-config-airbnb-base", new Map([
    ["13.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-config-airbnb-base-13.2.0-f6ea81459ff4dec2dda200c35f1d8f7419d57943-integrity/node_modules/eslint-config-airbnb-base/"),
      packageDependencies: new Map([
        ["eslint", "6.8.0"],
        ["eslint-plugin-import", "2.20.0"],
        ["confusing-browser-globals", "1.0.9"],
        ["object.assign", "4.1.0"],
        ["object.entries", "1.1.1"],
        ["eslint-config-airbnb-base", "13.2.0"],
      ]),
    }],
  ])],
  ["confusing-browser-globals", new Map([
    ["1.0.9", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-confusing-browser-globals-1.0.9-72bc13b483c0276801681871d4898516f8f54fdd-integrity/node_modules/confusing-browser-globals/"),
      packageDependencies: new Map([
        ["confusing-browser-globals", "1.0.9"],
      ]),
    }],
  ])],
  ["object.assign", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-object-assign-4.1.0-968bf1100d7956bb3ca086f006f846b3bc4008da-integrity/node_modules/object.assign/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["function-bind", "1.1.1"],
        ["has-symbols", "1.0.1"],
        ["object-keys", "1.1.1"],
        ["object.assign", "4.1.0"],
      ]),
    }],
  ])],
  ["define-properties", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-define-properties-1.1.3-cf88da6cbee26fe6db7094f61d870cbd84cee9f1-integrity/node_modules/define-properties/"),
      packageDependencies: new Map([
        ["object-keys", "1.1.1"],
        ["define-properties", "1.1.3"],
      ]),
    }],
  ])],
  ["object-keys", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-object-keys-1.1.1-1c47f272df277f3b1daf061677d9c82e2322c60e-integrity/node_modules/object-keys/"),
      packageDependencies: new Map([
        ["object-keys", "1.1.1"],
      ]),
    }],
  ])],
  ["function-bind", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-function-bind-1.1.1-a56899d3ea3c9bab874bb9773b7c5ede92f4895d-integrity/node_modules/function-bind/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.1"],
      ]),
    }],
  ])],
  ["has-symbols", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-has-symbols-1.0.1-9f5214758a44196c406d9bd76cebf81ec2dd31e8-integrity/node_modules/has-symbols/"),
      packageDependencies: new Map([
        ["has-symbols", "1.0.1"],
      ]),
    }],
  ])],
  ["object.entries", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-object-entries-1.1.1-ee1cf04153de02bb093fec33683900f57ce5399b-integrity/node_modules/object.entries/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["es-abstract", "1.17.3"],
        ["function-bind", "1.1.1"],
        ["has", "1.0.3"],
        ["object.entries", "1.1.1"],
      ]),
    }],
  ])],
  ["es-abstract", new Map([
    ["1.17.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-es-abstract-1.17.3-d921ff5889a3664921094bb13aaf0dfd11818578-integrity/node_modules/es-abstract/"),
      packageDependencies: new Map([
        ["es-to-primitive", "1.2.1"],
        ["function-bind", "1.1.1"],
        ["has", "1.0.3"],
        ["has-symbols", "1.0.1"],
        ["is-callable", "1.1.5"],
        ["is-regex", "1.0.5"],
        ["object-inspect", "1.7.0"],
        ["object-keys", "1.1.1"],
        ["object.assign", "4.1.0"],
        ["string.prototype.trimleft", "2.1.1"],
        ["string.prototype.trimright", "2.1.1"],
        ["es-abstract", "1.17.3"],
      ]),
    }],
  ])],
  ["es-to-primitive", new Map([
    ["1.2.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-es-to-primitive-1.2.1-e55cd4c9cdc188bcefb03b366c736323fc5c898a-integrity/node_modules/es-to-primitive/"),
      packageDependencies: new Map([
        ["is-callable", "1.1.5"],
        ["is-date-object", "1.0.2"],
        ["is-symbol", "1.0.3"],
        ["es-to-primitive", "1.2.1"],
      ]),
    }],
  ])],
  ["is-callable", new Map([
    ["1.1.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-callable-1.1.5-f7e46b596890456db74e7f6e976cb3273d06faab-integrity/node_modules/is-callable/"),
      packageDependencies: new Map([
        ["is-callable", "1.1.5"],
      ]),
    }],
  ])],
  ["is-date-object", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-date-object-1.0.2-bda736f2cd8fd06d32844e7743bfa7494c3bfd7e-integrity/node_modules/is-date-object/"),
      packageDependencies: new Map([
        ["is-date-object", "1.0.2"],
      ]),
    }],
  ])],
  ["is-symbol", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-symbol-1.0.3-38e1014b9e6329be0de9d24a414fd7441ec61937-integrity/node_modules/is-symbol/"),
      packageDependencies: new Map([
        ["has-symbols", "1.0.1"],
        ["is-symbol", "1.0.3"],
      ]),
    }],
  ])],
  ["has", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-has-1.0.3-722d7cbfc1f6aa8241f16dd814e011e1f41e8796-integrity/node_modules/has/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.1"],
        ["has", "1.0.3"],
      ]),
    }],
  ])],
  ["is-regex", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-regex-1.0.5-39d589a358bf18967f726967120b8fc1aed74eae-integrity/node_modules/is-regex/"),
      packageDependencies: new Map([
        ["has", "1.0.3"],
        ["is-regex", "1.0.5"],
      ]),
    }],
  ])],
  ["object-inspect", new Map([
    ["1.7.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-object-inspect-1.7.0-f4f6bd181ad77f006b5ece60bd0b6f398ff74a67-integrity/node_modules/object-inspect/"),
      packageDependencies: new Map([
        ["object-inspect", "1.7.0"],
      ]),
    }],
  ])],
  ["string.prototype.trimleft", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-string-prototype-trimleft-2.1.1-9bdb8ac6abd6d602b17a4ed321870d2f8dcefc74-integrity/node_modules/string.prototype.trimleft/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["function-bind", "1.1.1"],
        ["string.prototype.trimleft", "2.1.1"],
      ]),
    }],
  ])],
  ["string.prototype.trimright", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-string-prototype-trimright-2.1.1-440314b15996c866ce8a0341894d45186200c5d9-integrity/node_modules/string.prototype.trimright/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["function-bind", "1.1.1"],
        ["string.prototype.trimright", "2.1.1"],
      ]),
    }],
  ])],
  ["eslint-plugin-import", new Map([
    ["2.20.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-plugin-import-2.20.0-d749a7263fb6c29980def8e960d380a6aa6aecaa-integrity/node_modules/eslint-plugin-import/"),
      packageDependencies: new Map([
        ["eslint", "6.8.0"],
        ["array-includes", "3.1.1"],
        ["array.prototype.flat", "1.2.3"],
        ["contains-path", "0.1.0"],
        ["debug", "2.6.9"],
        ["doctrine", "1.5.0"],
        ["eslint-import-resolver-node", "0.3.3"],
        ["eslint-module-utils", "2.5.2"],
        ["has", "1.0.3"],
        ["minimatch", "3.0.4"],
        ["object.values", "1.1.1"],
        ["read-pkg-up", "2.0.0"],
        ["resolve", "1.14.2"],
        ["eslint-plugin-import", "2.20.0"],
      ]),
    }],
  ])],
  ["array-includes", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-array-includes-3.1.1-cdd67e6852bdf9c1215460786732255ed2459348-integrity/node_modules/array-includes/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["es-abstract", "1.17.3"],
        ["is-string", "1.0.5"],
        ["array-includes", "3.1.1"],
      ]),
    }],
  ])],
  ["is-string", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-is-string-1.0.5-40493ed198ef3ff477b8c7f92f644ec82a5cd3a6-integrity/node_modules/is-string/"),
      packageDependencies: new Map([
        ["is-string", "1.0.5"],
      ]),
    }],
  ])],
  ["array.prototype.flat", new Map([
    ["1.2.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-array-prototype-flat-1.2.3-0de82b426b0318dbfdb940089e38b043d37f6c7b-integrity/node_modules/array.prototype.flat/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["es-abstract", "1.17.3"],
        ["array.prototype.flat", "1.2.3"],
      ]),
    }],
  ])],
  ["contains-path", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-contains-path-0.1.0-fe8cf184ff6670b6baef01a9d4861a5cbec4120a-integrity/node_modules/contains-path/"),
      packageDependencies: new Map([
        ["contains-path", "0.1.0"],
      ]),
    }],
  ])],
  ["eslint-import-resolver-node", new Map([
    ["0.3.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-import-resolver-node-0.3.3-dbaa52b6b2816b50bc6711af75422de808e98404-integrity/node_modules/eslint-import-resolver-node/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["resolve", "1.14.2"],
        ["eslint-import-resolver-node", "0.3.3"],
      ]),
    }],
  ])],
  ["resolve", new Map([
    ["1.14.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-resolve-1.14.2-dbf31d0fa98b1f29aa5169783b9c290cb865fea2-integrity/node_modules/resolve/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
        ["resolve", "1.14.2"],
      ]),
    }],
  ])],
  ["path-parse", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c-integrity/node_modules/path-parse/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
      ]),
    }],
  ])],
  ["eslint-module-utils", new Map([
    ["2.5.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-module-utils-2.5.2-7878f7504824e1b857dd2505b59a8e5eda26a708-integrity/node_modules/eslint-module-utils/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["pkg-dir", "2.0.0"],
        ["eslint-module-utils", "2.5.2"],
      ]),
    }],
  ])],
  ["pkg-dir", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-pkg-dir-2.0.0-f6d5d1109e19d63edf428e0bd57e12777615334b-integrity/node_modules/pkg-dir/"),
      packageDependencies: new Map([
        ["find-up", "2.1.0"],
        ["pkg-dir", "2.0.0"],
      ]),
    }],
  ])],
  ["find-up", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-find-up-2.1.0-45d1b7e506c717ddd482775a2b77920a3c0c57a7-integrity/node_modules/find-up/"),
      packageDependencies: new Map([
        ["locate-path", "2.0.0"],
        ["find-up", "2.1.0"],
      ]),
    }],
  ])],
  ["locate-path", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-locate-path-2.0.0-2b568b265eec944c6d9c0de9c3dbbbca0354cd8e-integrity/node_modules/locate-path/"),
      packageDependencies: new Map([
        ["p-locate", "2.0.0"],
        ["path-exists", "3.0.0"],
        ["locate-path", "2.0.0"],
      ]),
    }],
  ])],
  ["p-locate", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-p-locate-2.0.0-20a0103b222a70c8fd39cc2e580680f3dde5ec43-integrity/node_modules/p-locate/"),
      packageDependencies: new Map([
        ["p-limit", "1.3.0"],
        ["p-locate", "2.0.0"],
      ]),
    }],
  ])],
  ["p-limit", new Map([
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-p-limit-1.3.0-b86bd5f0c25690911c7590fcbfc2010d54b3ccb8-integrity/node_modules/p-limit/"),
      packageDependencies: new Map([
        ["p-try", "1.0.0"],
        ["p-limit", "1.3.0"],
      ]),
    }],
  ])],
  ["p-try", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-p-try-1.0.0-cbc79cdbaf8fd4228e13f621f2b1a237c1b207b3-integrity/node_modules/p-try/"),
      packageDependencies: new Map([
        ["p-try", "1.0.0"],
      ]),
    }],
  ])],
  ["path-exists", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-path-exists-3.0.0-ce0ebeaa5f78cb18925ea7d810d7b59b010fd515-integrity/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["path-exists", "3.0.0"],
      ]),
    }],
  ])],
  ["object.values", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-object-values-1.1.1-68a99ecde356b7e9295a3c5e0ce31dc8c953de5e-integrity/node_modules/object.values/"),
      packageDependencies: new Map([
        ["define-properties", "1.1.3"],
        ["es-abstract", "1.17.3"],
        ["function-bind", "1.1.1"],
        ["has", "1.0.3"],
        ["object.values", "1.1.1"],
      ]),
    }],
  ])],
  ["read-pkg-up", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-read-pkg-up-2.0.0-6b72a8048984e0c41e79510fd5e9fa99b3b549be-integrity/node_modules/read-pkg-up/"),
      packageDependencies: new Map([
        ["find-up", "2.1.0"],
        ["read-pkg", "2.0.0"],
        ["read-pkg-up", "2.0.0"],
      ]),
    }],
  ])],
  ["read-pkg", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-read-pkg-2.0.0-8ef1c0623c6a6db0dc6713c4bfac46332b2368f8-integrity/node_modules/read-pkg/"),
      packageDependencies: new Map([
        ["load-json-file", "2.0.0"],
        ["normalize-package-data", "2.5.0"],
        ["path-type", "2.0.0"],
        ["read-pkg", "2.0.0"],
      ]),
    }],
  ])],
  ["load-json-file", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-load-json-file-2.0.0-7947e42149af80d696cbf797bcaabcfe1fe29ca8-integrity/node_modules/load-json-file/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.3"],
        ["parse-json", "2.2.0"],
        ["pify", "2.3.0"],
        ["strip-bom", "3.0.0"],
        ["load-json-file", "2.0.0"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.2.3", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-graceful-fs-4.2.3-4a12ff1b60376ef09862c2093edd908328be8423-integrity/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.3"],
      ]),
    }],
  ])],
  ["parse-json", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9-integrity/node_modules/parse-json/"),
      packageDependencies: new Map([
        ["error-ex", "1.3.2"],
        ["parse-json", "2.2.0"],
      ]),
    }],
  ])],
  ["error-ex", new Map([
    ["1.3.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf-integrity/node_modules/error-ex/"),
      packageDependencies: new Map([
        ["is-arrayish", "0.2.1"],
        ["error-ex", "1.3.2"],
      ]),
    }],
  ])],
  ["strip-bom", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-strip-bom-3.0.0-2334c18e9c759f7bdd56fdef7e9ae3d588e68ed3-integrity/node_modules/strip-bom/"),
      packageDependencies: new Map([
        ["strip-bom", "3.0.0"],
      ]),
    }],
  ])],
  ["normalize-package-data", new Map([
    ["2.5.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8-integrity/node_modules/normalize-package-data/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.5"],
        ["resolve", "1.14.2"],
        ["semver", "5.7.1"],
        ["validate-npm-package-license", "3.0.4"],
        ["normalize-package-data", "2.5.0"],
      ]),
    }],
  ])],
  ["hosted-git-info", new Map([
    ["2.8.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-hosted-git-info-2.8.5-759cfcf2c4d156ade59b0b2dfabddc42a6b9c70c-integrity/node_modules/hosted-git-info/"),
      packageDependencies: new Map([
        ["hosted-git-info", "2.8.5"],
      ]),
    }],
  ])],
  ["validate-npm-package-license", new Map([
    ["3.0.4", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a-integrity/node_modules/validate-npm-package-license/"),
      packageDependencies: new Map([
        ["spdx-correct", "3.1.0"],
        ["spdx-expression-parse", "3.0.0"],
        ["validate-npm-package-license", "3.0.4"],
      ]),
    }],
  ])],
  ["spdx-correct", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4-integrity/node_modules/spdx-correct/"),
      packageDependencies: new Map([
        ["spdx-expression-parse", "3.0.0"],
        ["spdx-license-ids", "3.0.5"],
        ["spdx-correct", "3.1.0"],
      ]),
    }],
  ])],
  ["spdx-expression-parse", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0-integrity/node_modules/spdx-expression-parse/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
        ["spdx-license-ids", "3.0.5"],
        ["spdx-expression-parse", "3.0.0"],
      ]),
    }],
  ])],
  ["spdx-exceptions", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977-integrity/node_modules/spdx-exceptions/"),
      packageDependencies: new Map([
        ["spdx-exceptions", "2.2.0"],
      ]),
    }],
  ])],
  ["spdx-license-ids", new Map([
    ["3.0.5", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-spdx-license-ids-3.0.5-3694b5804567a458d3c8045842a6358632f62654-integrity/node_modules/spdx-license-ids/"),
      packageDependencies: new Map([
        ["spdx-license-ids", "3.0.5"],
      ]),
    }],
  ])],
  ["path-type", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-path-type-2.0.0-f012ccb8415b7096fc2daa1054c3d72389594c73-integrity/node_modules/path-type/"),
      packageDependencies: new Map([
        ["pify", "2.3.0"],
        ["path-type", "2.0.0"],
      ]),
    }],
  ])],
  ["eslint-plugin-unicorn", new Map([
    ["9.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-plugin-unicorn-9.1.1-1588a0473f9a0e37cfbbcf7552065a0b0a96ce26-integrity/node_modules/eslint-plugin-unicorn/"),
      packageDependencies: new Map([
        ["eslint", "6.8.0"],
        ["clean-regexp", "1.0.0"],
        ["eslint-ast-utils", "1.1.0"],
        ["import-modules", "1.1.0"],
        ["lodash.camelcase", "4.3.0"],
        ["lodash.defaultsdeep", "4.6.1"],
        ["lodash.kebabcase", "4.1.1"],
        ["lodash.snakecase", "4.1.1"],
        ["lodash.topairs", "4.3.0"],
        ["lodash.upperfirst", "4.3.1"],
        ["regexpp", "2.0.1"],
        ["reserved-words", "0.1.2"],
        ["safe-regex", "2.1.1"],
        ["eslint-plugin-unicorn", "9.1.1"],
      ]),
    }],
  ])],
  ["clean-regexp", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-clean-regexp-1.0.0-8df7c7aae51fd36874e8f8d05b9180bc11a3fed7-integrity/node_modules/clean-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
        ["clean-regexp", "1.0.0"],
      ]),
    }],
  ])],
  ["eslint-ast-utils", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-eslint-ast-utils-1.1.0-3d58ba557801cfb1c941d68131ee9f8c34bd1586-integrity/node_modules/eslint-ast-utils/"),
      packageDependencies: new Map([
        ["lodash.get", "4.4.2"],
        ["lodash.zip", "4.2.0"],
        ["eslint-ast-utils", "1.1.0"],
      ]),
    }],
  ])],
  ["lodash.get", new Map([
    ["4.4.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-lodash-get-4.4.2-2d177f652fa31e939b4438d5341499dfa3825e99-integrity/node_modules/lodash.get/"),
      packageDependencies: new Map([
        ["lodash.get", "4.4.2"],
      ]),
    }],
  ])],
  ["lodash.zip", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-lodash-zip-4.2.0-ec6662e4896408ed4ab6c542a3990b72cc080020-integrity/node_modules/lodash.zip/"),
      packageDependencies: new Map([
        ["lodash.zip", "4.2.0"],
      ]),
    }],
  ])],
  ["import-modules", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-import-modules-1.1.0-748db79c5cc42bb9701efab424f894e72600e9dc-integrity/node_modules/import-modules/"),
      packageDependencies: new Map([
        ["import-modules", "1.1.0"],
      ]),
    }],
  ])],
  ["lodash.camelcase", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-lodash-camelcase-4.3.0-b28aa6288a2b9fc651035c7711f65ab6190331a6-integrity/node_modules/lodash.camelcase/"),
      packageDependencies: new Map([
        ["lodash.camelcase", "4.3.0"],
      ]),
    }],
  ])],
  ["lodash.defaultsdeep", new Map([
    ["4.6.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-lodash-defaultsdeep-4.6.1-512e9bd721d272d94e3d3a63653fa17516741ca6-integrity/node_modules/lodash.defaultsdeep/"),
      packageDependencies: new Map([
        ["lodash.defaultsdeep", "4.6.1"],
      ]),
    }],
  ])],
  ["lodash.kebabcase", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-lodash-kebabcase-4.1.1-8489b1cb0d29ff88195cceca448ff6d6cc295c36-integrity/node_modules/lodash.kebabcase/"),
      packageDependencies: new Map([
        ["lodash.kebabcase", "4.1.1"],
      ]),
    }],
  ])],
  ["lodash.snakecase", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-lodash-snakecase-4.1.1-39d714a35357147837aefd64b5dcbb16becd8f8d-integrity/node_modules/lodash.snakecase/"),
      packageDependencies: new Map([
        ["lodash.snakecase", "4.1.1"],
      ]),
    }],
  ])],
  ["lodash.topairs", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-lodash-topairs-4.3.0-3b6deaa37d60fb116713c46c5f17ea190ec48d64-integrity/node_modules/lodash.topairs/"),
      packageDependencies: new Map([
        ["lodash.topairs", "4.3.0"],
      ]),
    }],
  ])],
  ["lodash.upperfirst", new Map([
    ["4.3.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-lodash-upperfirst-4.3.1-1365edf431480481ef0d1c68957a5ed99d49f7ce-integrity/node_modules/lodash.upperfirst/"),
      packageDependencies: new Map([
        ["lodash.upperfirst", "4.3.1"],
      ]),
    }],
  ])],
  ["reserved-words", new Map([
    ["0.1.2", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-reserved-words-0.1.2-00a0940f98cd501aeaaac316411d9adc52b31ab1-integrity/node_modules/reserved-words/"),
      packageDependencies: new Map([
        ["reserved-words", "0.1.2"],
      ]),
    }],
  ])],
  ["safe-regex", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-safe-regex-2.1.1-f7128f00d056e2fe5c11e81a1324dd974aadced2-integrity/node_modules/safe-regex/"),
      packageDependencies: new Map([
        ["regexp-tree", "0.1.17"],
        ["safe-regex", "2.1.1"],
      ]),
    }],
  ])],
  ["regexp-tree", new Map([
    ["0.1.17", {
      packageLocation: path.resolve(__dirname, "../../../yarn/v6/npm-regexp-tree-0.1.17-66d914a6ca21f95dd7660ed70a7dad47aeb2246a-integrity/node_modules/regexp-tree/"),
      packageDependencies: new Map([
        ["regexp-tree", "0.1.17"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["canvas", "2.6.1"],
        ["chalk", "2.4.2"],
        ["chunk", "0.0.2"],
        ["jimp", "0.9.3"],
        ["js-yaml", "3.13.1"],
        ["mongoose", "5.8.9"],
        ["nanoid", "2.1.9"],
        ["png-to-jpeg", "1.0.1"],
        ["sharp", "0.24.0"],
        ["telegraf", "3.35.0"],
        ["telegraf-i18n", "6.6.0"],
        ["telegraf-session-redis", "5.1.0"],
        ["telegraph-uploader", "2.0.0"],
        ["winston", "3.2.1"],
        ["eslint", "6.8.0"],
        ["eslint-config-airbnb-base", "13.2.0"],
        ["eslint-plugin-import", "2.20.0"],
        ["eslint-plugin-unicorn", "9.1.1"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["./.pnp/unplugged/npm-canvas-2.6.1-0d087dd4d60f5a5a9efa202757270abea8bef89e-integrity/node_modules/canvas/", {"name":"canvas","reference":"2.6.1"}],
  ["../../../yarn/v6/npm-nan-2.14.0-7818f722027b2459a86f0295d434d1fc2336c52c-integrity/node_modules/nan/", {"name":"nan","reference":"2.14.0"}],
  ["../../../yarn/v6/npm-node-pre-gyp-0.11.0-db1f33215272f692cd38f03238e3e9b47c5dd054-integrity/node_modules/node-pre-gyp/", {"name":"node-pre-gyp","reference":"0.11.0"}],
  ["../../../yarn/v6/npm-detect-libc-1.0.3-fa137c4bd698edf55cd5cd02ac559f91a4c4ba9b-integrity/node_modules/detect-libc/", {"name":"detect-libc","reference":"1.0.3"}],
  ["../../../yarn/v6/npm-mkdirp-0.5.1-30057438eac6cf7f8c4767f38648d6697d75c903-integrity/node_modules/mkdirp/", {"name":"mkdirp","reference":"0.5.1"}],
  ["../../../yarn/v6/npm-minimist-0.0.8-857fcabfc3397d2625b8228262e86aa7a011b05d-integrity/node_modules/minimist/", {"name":"minimist","reference":"0.0.8"}],
  ["../../../yarn/v6/npm-minimist-1.2.0-a35008b20f41383eec1fb914f4cd5df79a264284-integrity/node_modules/minimist/", {"name":"minimist","reference":"1.2.0"}],
  ["../../../yarn/v6/npm-needle-2.4.0-6833e74975c444642590e15a750288c5f939b57c-integrity/node_modules/needle/", {"name":"needle","reference":"2.4.0"}],
  ["../../../yarn/v6/npm-debug-3.2.6-e83d17de16d8a7efb7717edbe5fb10135eee629b-integrity/node_modules/debug/", {"name":"debug","reference":"3.2.6"}],
  ["../../../yarn/v6/npm-debug-3.1.0-5bb5a0672628b64149566ba16819e61518c67261-integrity/node_modules/debug/", {"name":"debug","reference":"3.1.0"}],
  ["../../../yarn/v6/npm-debug-4.1.1-3b72260255109c6b589cee050f1d516139664791-integrity/node_modules/debug/", {"name":"debug","reference":"4.1.1"}],
  ["../../../yarn/v6/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f-integrity/node_modules/debug/", {"name":"debug","reference":"2.6.9"}],
  ["../../../yarn/v6/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009-integrity/node_modules/ms/", {"name":"ms","reference":"2.1.2"}],
  ["../../../yarn/v6/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8-integrity/node_modules/ms/", {"name":"ms","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b-integrity/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.24"}],
  ["../../../yarn/v6/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a-integrity/node_modules/safer-buffer/", {"name":"safer-buffer","reference":"2.1.2"}],
  ["../../../yarn/v6/npm-sax-1.2.4-2816234e2378bddc4e5354fab5caa895df7100d9-integrity/node_modules/sax/", {"name":"sax","reference":"1.2.4"}],
  ["../../../yarn/v6/npm-nopt-4.0.1-d0d4685afd5415193c8c7505602d0d17cd64474d-integrity/node_modules/nopt/", {"name":"nopt","reference":"4.0.1"}],
  ["../../../yarn/v6/npm-abbrev-1.1.1-f8f2c887ad10bf67f634f005b6987fed3179aac8-integrity/node_modules/abbrev/", {"name":"abbrev","reference":"1.1.1"}],
  ["../../../yarn/v6/npm-osenv-0.1.5-85cdfafaeb28e8677f416e287592b5f3f49ea410-integrity/node_modules/osenv/", {"name":"osenv","reference":"0.1.5"}],
  ["../../../yarn/v6/npm-os-homedir-1.0.2-ffbc4988336e0e833de0c168c7ef152121aa7fb3-integrity/node_modules/os-homedir/", {"name":"os-homedir","reference":"1.0.2"}],
  ["../../../yarn/v6/npm-os-tmpdir-1.0.2-bbe67406c79aa85c5cfec766fe5734555dfa1274-integrity/node_modules/os-tmpdir/", {"name":"os-tmpdir","reference":"1.0.2"}],
  ["../../../yarn/v6/npm-npm-packlist-1.4.7-9e954365a06b80b18111ea900945af4f88ed4848-integrity/node_modules/npm-packlist/", {"name":"npm-packlist","reference":"1.4.7"}],
  ["../../../yarn/v6/npm-ignore-walk-3.0.3-017e2447184bfeade7c238e4aefdd1e8f95b1e37-integrity/node_modules/ignore-walk/", {"name":"ignore-walk","reference":"3.0.3"}],
  ["../../../yarn/v6/npm-minimatch-3.0.4-5166e286457f03306064be5497e8dbb0c3d32083-integrity/node_modules/minimatch/", {"name":"minimatch","reference":"3.0.4"}],
  ["../../../yarn/v6/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd-integrity/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"1.1.11"}],
  ["../../../yarn/v6/npm-balanced-match-1.0.0-89b4d199ab2bee49de164ea02b89ce462d71b767-integrity/node_modules/balanced-match/", {"name":"balanced-match","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b-integrity/node_modules/concat-map/", {"name":"concat-map","reference":"0.0.1"}],
  ["../../../yarn/v6/npm-npm-bundled-1.1.1-1edd570865a94cdb1bc8220775e29466c9fb234b-integrity/node_modules/npm-bundled/", {"name":"npm-bundled","reference":"1.1.1"}],
  ["../../../yarn/v6/npm-npm-normalize-package-bin-1.0.1-6e79a41f23fd235c0623218228da7d9c23b8f6e2-integrity/node_modules/npm-normalize-package-bin/", {"name":"npm-normalize-package-bin","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-npmlog-4.1.2-08a7f2a8bf734604779a9efa4ad5cc717abb954b-integrity/node_modules/npmlog/", {"name":"npmlog","reference":"4.1.2"}],
  ["../../../yarn/v6/npm-are-we-there-yet-1.1.5-4b35c2944f062a8bfcda66410760350fe9ddfc21-integrity/node_modules/are-we-there-yet/", {"name":"are-we-there-yet","reference":"1.1.5"}],
  ["../../../yarn/v6/npm-delegates-1.0.0-84c6e159b81904fdca59a0ef44cd870d31250f9a-integrity/node_modules/delegates/", {"name":"delegates","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-readable-stream-2.3.7-1eca1cf711aef814c04f62252a36a62f6cb23b57-integrity/node_modules/readable-stream/", {"name":"readable-stream","reference":"2.3.7"}],
  ["../../../yarn/v6/npm-readable-stream-3.5.0-465d70e6d1087f6162d079cd0b5db7fbebfd1606-integrity/node_modules/readable-stream/", {"name":"readable-stream","reference":"3.5.0"}],
  ["../../../yarn/v6/npm-core-util-is-1.0.2-b5fd54220aa2bc5ab57aab7140c940754503c1a7-integrity/node_modules/core-util-is/", {"name":"core-util-is","reference":"1.0.2"}],
  ["../../../yarn/v6/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c-integrity/node_modules/inherits/", {"name":"inherits","reference":"2.0.4"}],
  ["../../../yarn/v6/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11-integrity/node_modules/isarray/", {"name":"isarray","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2-integrity/node_modules/process-nextick-args/", {"name":"process-nextick-args","reference":"2.0.1"}],
  ["../../../yarn/v6/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d-integrity/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.1.2"}],
  ["../../../yarn/v6/npm-safe-buffer-5.2.0-b74daec49b1148f88c64b68d49b1e815c1f2f519-integrity/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.2.0"}],
  ["../../../yarn/v6/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8-integrity/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.1.1"}],
  ["../../../yarn/v6/npm-string-decoder-1.3.0-42f114594a46cf1a8e30b0a84f56c78c3edac21e-integrity/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.3.0"}],
  ["../../../yarn/v6/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf-integrity/node_modules/util-deprecate/", {"name":"util-deprecate","reference":"1.0.2"}],
  ["../../../yarn/v6/npm-console-control-strings-1.1.0-3d7cf4464db6446ea644bf4b39507f9851008e8e-integrity/node_modules/console-control-strings/", {"name":"console-control-strings","reference":"1.1.0"}],
  ["../../../yarn/v6/npm-gauge-2.7.4-2c03405c7538c39d7eb37b317022e325fb018bf7-integrity/node_modules/gauge/", {"name":"gauge","reference":"2.7.4"}],
  ["../../../yarn/v6/npm-aproba-1.2.0-6802e6264efd18c790a1b0d517f0f2627bf2c94a-integrity/node_modules/aproba/", {"name":"aproba","reference":"1.2.0"}],
  ["../../../yarn/v6/npm-has-unicode-2.0.1-e0e6fe6a28cf51138855e086d1691e771de2a8b9-integrity/node_modules/has-unicode/", {"name":"has-unicode","reference":"2.0.1"}],
  ["../../../yarn/v6/npm-object-assign-4.1.1-2109adc7965887cfc05cbbd442cac8bfbb360863-integrity/node_modules/object-assign/", {"name":"object-assign","reference":"4.1.1"}],
  ["../../../yarn/v6/npm-signal-exit-3.0.2-b5fdc08f1287ea1178628e415e25132b73646c6d-integrity/node_modules/signal-exit/", {"name":"signal-exit","reference":"3.0.2"}],
  ["../../../yarn/v6/npm-string-width-1.0.2-118bdf5b8cdc51a2a7e70d211e07e2b0b9b107d3-integrity/node_modules/string-width/", {"name":"string-width","reference":"1.0.2"}],
  ["../../../yarn/v6/npm-string-width-2.1.1-ab93f27a8dc13d28cac815c462143a6d9012ae9e-integrity/node_modules/string-width/", {"name":"string-width","reference":"2.1.1"}],
  ["../../../yarn/v6/npm-string-width-4.2.0-952182c46cc7b2c313d1596e623992bd163b72b5-integrity/node_modules/string-width/", {"name":"string-width","reference":"4.2.0"}],
  ["../../../yarn/v6/npm-string-width-3.1.0-22767be21b62af1081574306f69ac51b62203961-integrity/node_modules/string-width/", {"name":"string-width","reference":"3.1.0"}],
  ["../../../yarn/v6/npm-code-point-at-1.1.0-0d070b4d043a5bea33a2f1a40e2edb3d9a4ccf77-integrity/node_modules/code-point-at/", {"name":"code-point-at","reference":"1.1.0"}],
  ["../../../yarn/v6/npm-is-fullwidth-code-point-1.0.0-ef9e31386f031a7f0d643af82fde50c457ef00cb-integrity/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-is-fullwidth-code-point-2.0.0-a3b30a5c4f199183167aaab93beefae3ddfb654f-integrity/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-is-fullwidth-code-point-3.0.0-f116f8064fe90b3f7844a38997c0b75051269f1d-integrity/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-number-is-nan-1.0.1-097b602b53422a522c1afb8790318336941a011d-integrity/node_modules/number-is-nan/", {"name":"number-is-nan","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-strip-ansi-3.0.1-6a385fb8853d952d5ff05d0e8aaf94278dc63dcf-integrity/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"3.0.1"}],
  ["../../../yarn/v6/npm-strip-ansi-4.0.0-a8479022eb1ac368a871389b635262c505ee368f-integrity/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"4.0.0"}],
  ["../../../yarn/v6/npm-strip-ansi-6.0.0-0b1571dd7669ccd4f3e06e14ef1eed26225ae532-integrity/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"6.0.0"}],
  ["../../../yarn/v6/npm-strip-ansi-5.2.0-8c9a536feb6afc962bdfa5b104a5091c1ad9c0ae-integrity/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"5.2.0"}],
  ["../../../yarn/v6/npm-ansi-regex-2.1.1-c3b33ab5ee360d86e0e628f0468ae7ef27d654df-integrity/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"2.1.1"}],
  ["../../../yarn/v6/npm-ansi-regex-3.0.0-ed0317c322064f79466c02966bddb605ab37d998-integrity/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-ansi-regex-5.0.0-388539f55179bf39339c81af30a654d69f87cb75-integrity/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"5.0.0"}],
  ["../../../yarn/v6/npm-ansi-regex-4.1.0-8b9f8f08cf1acb843756a839ca8c7e3168c51997-integrity/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"4.1.0"}],
  ["../../../yarn/v6/npm-wide-align-1.1.3-ae074e6bdc0c14a431e804e624549c633b000457-integrity/node_modules/wide-align/", {"name":"wide-align","reference":"1.1.3"}],
  ["../../../yarn/v6/npm-set-blocking-2.0.0-045f9782d011ae9a6803ddd382b24392b3d890f7-integrity/node_modules/set-blocking/", {"name":"set-blocking","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-rc-1.2.8-cd924bf5200a075b83c188cd6b9e211b7fc0d3ed-integrity/node_modules/rc/", {"name":"rc","reference":"1.2.8"}],
  ["../../../yarn/v6/npm-deep-extend-0.6.0-c4fa7c95404a17a9c3e8ca7e1537312b736330ac-integrity/node_modules/deep-extend/", {"name":"deep-extend","reference":"0.6.0"}],
  ["../../../yarn/v6/npm-ini-1.3.5-eee25f56db1c9ec6085e0c22778083f596abf927-integrity/node_modules/ini/", {"name":"ini","reference":"1.3.5"}],
  ["../../../yarn/v6/npm-strip-json-comments-2.0.1-3c531942e908c2697c0ec344858c286c7ca0a60a-integrity/node_modules/strip-json-comments/", {"name":"strip-json-comments","reference":"2.0.1"}],
  ["../../../yarn/v6/npm-strip-json-comments-3.0.1-85713975a91fb87bf1b305cca77395e40d2a64a7-integrity/node_modules/strip-json-comments/", {"name":"strip-json-comments","reference":"3.0.1"}],
  ["../../../yarn/v6/npm-rimraf-2.7.1-35797f13a7fdadc566142c29d4f07ccad483e3ec-integrity/node_modules/rimraf/", {"name":"rimraf","reference":"2.7.1"}],
  ["../../../yarn/v6/npm-rimraf-2.6.3-b2d104fe0d8fb27cf9e0a1cda8262dd3833c6cab-integrity/node_modules/rimraf/", {"name":"rimraf","reference":"2.6.3"}],
  ["../../../yarn/v6/npm-glob-7.1.6-141f33b81a7c2492e125594307480c46679278a6-integrity/node_modules/glob/", {"name":"glob","reference":"7.1.6"}],
  ["../../../yarn/v6/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f-integrity/node_modules/fs.realpath/", {"name":"fs.realpath","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9-integrity/node_modules/inflight/", {"name":"inflight","reference":"1.0.6"}],
  ["../../../yarn/v6/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1-integrity/node_modules/once/", {"name":"once","reference":"1.4.0"}],
  ["../../../yarn/v6/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f-integrity/node_modules/wrappy/", {"name":"wrappy","reference":"1.0.2"}],
  ["../../../yarn/v6/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f-integrity/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-semver-5.7.1-a954f931aeba508d307bbf069eff0c01c96116f7-integrity/node_modules/semver/", {"name":"semver","reference":"5.7.1"}],
  ["../../../yarn/v6/npm-semver-7.1.1-29104598a197d6cbe4733eeecbe968f7b43a9667-integrity/node_modules/semver/", {"name":"semver","reference":"7.1.1"}],
  ["../../../yarn/v6/npm-semver-6.3.0-ee0a64c8af5e8ceea67687b133761e1becbd1d3d-integrity/node_modules/semver/", {"name":"semver","reference":"6.3.0"}],
  ["../../../yarn/v6/npm-tar-4.4.13-43b364bc52888d555298637b10d60790254ab525-integrity/node_modules/tar/", {"name":"tar","reference":"4.4.13"}],
  ["../../../yarn/v6/npm-tar-5.0.5-03fcdb7105bc8ea3ce6c86642b9c942495b04f93-integrity/node_modules/tar/", {"name":"tar","reference":"5.0.5"}],
  ["../../../yarn/v6/npm-chownr-1.1.3-42d837d5239688d55f303003a508230fa6727142-integrity/node_modules/chownr/", {"name":"chownr","reference":"1.1.3"}],
  ["../../../yarn/v6/npm-fs-minipass-1.2.7-ccff8570841e7fe4265693da88936c55aed7f7c7-integrity/node_modules/fs-minipass/", {"name":"fs-minipass","reference":"1.2.7"}],
  ["../../../yarn/v6/npm-fs-minipass-2.0.0-a6415edab02fae4b9e9230bc87ee2e4472003cd1-integrity/node_modules/fs-minipass/", {"name":"fs-minipass","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-minipass-2.9.0-e713762e7d3e32fed803115cf93e04bca9fcc9a6-integrity/node_modules/minipass/", {"name":"minipass","reference":"2.9.0"}],
  ["../../../yarn/v6/npm-minipass-3.1.1-7607ce778472a185ad6d89082aa2070f79cedcd5-integrity/node_modules/minipass/", {"name":"minipass","reference":"3.1.1"}],
  ["../../../yarn/v6/npm-yallist-3.1.1-dbb7daf9bfd8bac9ab45ebf602b8cbad0d5d08fd-integrity/node_modules/yallist/", {"name":"yallist","reference":"3.1.1"}],
  ["../../../yarn/v6/npm-yallist-4.0.0-9bb92790d9c0effec63be73519e11a35019a3a72-integrity/node_modules/yallist/", {"name":"yallist","reference":"4.0.0"}],
  ["../../../yarn/v6/npm-minizlib-1.3.3-2290de96818a34c29551c8a8d301216bd65a861d-integrity/node_modules/minizlib/", {"name":"minizlib","reference":"1.3.3"}],
  ["../../../yarn/v6/npm-minizlib-2.1.0-fd52c645301ef09a63a2c209697c294c6ce02cf3-integrity/node_modules/minizlib/", {"name":"minizlib","reference":"2.1.0"}],
  ["../../../yarn/v6/npm-simple-get-3.1.0-b45be062435e50d159540b576202ceec40b9c6b3-integrity/node_modules/simple-get/", {"name":"simple-get","reference":"3.1.0"}],
  ["../../../yarn/v6/npm-decompress-response-4.2.1-414023cc7a302da25ce2ec82d0d5238ccafd8986-integrity/node_modules/decompress-response/", {"name":"decompress-response","reference":"4.2.1"}],
  ["../../../yarn/v6/npm-mimic-response-2.0.0-996a51c60adf12cb8a87d7fb8ef24c2f3d5ebb46-integrity/node_modules/mimic-response/", {"name":"mimic-response","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-simple-concat-1.0.0-7344cbb8b6e26fb27d66b2fc86f9f6d5997521c6-integrity/node_modules/simple-concat/", {"name":"simple-concat","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424-integrity/node_modules/chalk/", {"name":"chalk","reference":"2.4.2"}],
  ["../../../yarn/v6/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d-integrity/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"3.2.1"}],
  ["../../../yarn/v6/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8-integrity/node_modules/color-convert/", {"name":"color-convert","reference":"1.9.3"}],
  ["../../../yarn/v6/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25-integrity/node_modules/color-name/", {"name":"color-name","reference":"1.1.3"}],
  ["../../../yarn/v6/npm-color-name-1.1.4-c2a09a87acbde69543de6f63fa3995c826c536a2-integrity/node_modules/color-name/", {"name":"color-name","reference":"1.1.4"}],
  ["../../../yarn/v6/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4-integrity/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"1.0.5"}],
  ["../../../yarn/v6/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f-integrity/node_modules/supports-color/", {"name":"supports-color","reference":"5.5.0"}],
  ["../../../yarn/v6/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd-integrity/node_modules/has-flag/", {"name":"has-flag","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-chunk-0.0.2-04aa4f31664ae850de500cf8d57b5f4c29cd522e-integrity/node_modules/chunk/", {"name":"chunk","reference":"0.0.2"}],
  ["../../../yarn/v6/npm-jimp-0.9.3-85e8e80eea65a7e6de806c6bb622ec6a7244e6f3-integrity/node_modules/jimp/", {"name":"jimp","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@babel-runtime-7.8.3-0811944f73a6c926bb2ad35e918dcc1bfab279f1-integrity/node_modules/@babel/runtime/", {"name":"@babel/runtime","reference":"7.8.3"}],
  ["../../../yarn/v6/npm-regenerator-runtime-0.13.3-7cf6a77d8f5c6f60eb73c5fc1955b2ceb01e6bf5-integrity/node_modules/regenerator-runtime/", {"name":"regenerator-runtime","reference":"0.13.3"}],
  ["../../../yarn/v6/npm-@jimp-custom-0.9.3-b49dfe1d6b24e62fd4101a7db77104024c8d97e8-integrity/node_modules/@jimp/custom/", {"name":"@jimp/custom","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-core-0.9.3-bffbf955c046569bf4b682b575228e31bb41e445-integrity/node_modules/@jimp/core/", {"name":"@jimp/core","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-utils-0.9.3-fd7af0d1138febbeacc841be4b802218444ce088-integrity/node_modules/@jimp/utils/", {"name":"@jimp/utils","reference":"0.9.3"}],
  ["./.pnp/unplugged/npm-core-js-3.6.4-440a83536b458114b9cb2ac1580ba377dc470647-integrity/node_modules/core-js/", {"name":"core-js","reference":"3.6.4"}],
  ["../../../yarn/v6/npm-any-base-1.1.0-ae101a62bc08a597b4c9ab5b7089d456630549fe-integrity/node_modules/any-base/", {"name":"any-base","reference":"1.1.0"}],
  ["../../../yarn/v6/npm-buffer-5.4.3-3fbc9c69eb713d323e3fc1a895eee0710c072115-integrity/node_modules/buffer/", {"name":"buffer","reference":"5.4.3"}],
  ["../../../yarn/v6/npm-base64-js-1.3.1-58ece8cb75dd07e71ed08c736abc5fac4dbf8df1-integrity/node_modules/base64-js/", {"name":"base64-js","reference":"1.3.1"}],
  ["../../../yarn/v6/npm-ieee754-1.1.13-ec168558e95aa181fd87d37f55c32bbcb6708b84-integrity/node_modules/ieee754/", {"name":"ieee754","reference":"1.1.13"}],
  ["../../../yarn/v6/npm-exif-parser-0.1.12-58a9d2d72c02c1f6f02a0ef4a9166272b7760922-integrity/node_modules/exif-parser/", {"name":"exif-parser","reference":"0.1.12"}],
  ["../../../yarn/v6/npm-file-type-9.0.0-a68d5ad07f486414dfb2c8866f73161946714a18-integrity/node_modules/file-type/", {"name":"file-type","reference":"9.0.0"}],
  ["../../../yarn/v6/npm-load-bmfont-1.4.0-75f17070b14a8c785fe7f5bee2e6fd4f98093b6b-integrity/node_modules/load-bmfont/", {"name":"load-bmfont","reference":"1.4.0"}],
  ["../../../yarn/v6/npm-buffer-equal-0.0.1-91bc74b11ea405bc916bc6aa908faafa5b4aac4b-integrity/node_modules/buffer-equal/", {"name":"buffer-equal","reference":"0.0.1"}],
  ["../../../yarn/v6/npm-mime-1.6.0-32cd9e5c64553bd58d19a568af452acff04981b1-integrity/node_modules/mime/", {"name":"mime","reference":"1.6.0"}],
  ["../../../yarn/v6/npm-parse-bmfont-ascii-1.0.6-11ac3c3ff58f7c2020ab22769079108d4dfa0285-integrity/node_modules/parse-bmfont-ascii/", {"name":"parse-bmfont-ascii","reference":"1.0.6"}],
  ["../../../yarn/v6/npm-parse-bmfont-binary-1.0.6-d038b476d3e9dd9db1e11a0b0e53a22792b69006-integrity/node_modules/parse-bmfont-binary/", {"name":"parse-bmfont-binary","reference":"1.0.6"}],
  ["../../../yarn/v6/npm-parse-bmfont-xml-1.1.4-015319797e3e12f9e739c4d513872cd2fa35f389-integrity/node_modules/parse-bmfont-xml/", {"name":"parse-bmfont-xml","reference":"1.1.4"}],
  ["../../../yarn/v6/npm-xml-parse-from-string-1.0.1-a9029e929d3dbcded169f3c6e28238d95a5d5a28-integrity/node_modules/xml-parse-from-string/", {"name":"xml-parse-from-string","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-xml2js-0.4.23-a0c69516752421eb2ac758ee4d4ccf58843eac66-integrity/node_modules/xml2js/", {"name":"xml2js","reference":"0.4.23"}],
  ["../../../yarn/v6/npm-xmlbuilder-11.0.1-be9bae1c8a046e76b31127726347d0ad7002beb3-integrity/node_modules/xmlbuilder/", {"name":"xmlbuilder","reference":"11.0.1"}],
  ["../../../yarn/v6/npm-phin-2.9.3-f9b6ac10a035636fb65dfc576aaaa17b8743125c-integrity/node_modules/phin/", {"name":"phin","reference":"2.9.3"}],
  ["../../../yarn/v6/npm-xhr-2.5.0-bed8d1676d5ca36108667692b74b316c496e49dd-integrity/node_modules/xhr/", {"name":"xhr","reference":"2.5.0"}],
  ["../../../yarn/v6/npm-global-4.3.2-e76989268a6c74c38908b1305b10fc0e394e9d0f-integrity/node_modules/global/", {"name":"global","reference":"4.3.2"}],
  ["../../../yarn/v6/npm-min-document-2.19.0-7bd282e3f5842ed295bb748cdd9f1ffa2c824685-integrity/node_modules/min-document/", {"name":"min-document","reference":"2.19.0"}],
  ["../../../yarn/v6/npm-dom-walk-0.1.1-672226dc74c8f799ad35307df936aba11acd6018-integrity/node_modules/dom-walk/", {"name":"dom-walk","reference":"0.1.1"}],
  ["../../../yarn/v6/npm-process-0.5.2-1638d8a8e34c2f440a91db95ab9aeb677fc185cf-integrity/node_modules/process/", {"name":"process","reference":"0.5.2"}],
  ["../../../yarn/v6/npm-is-function-1.0.1-12cfb98b65b57dd3d193a3121f5f6e2f437602b5-integrity/node_modules/is-function/", {"name":"is-function","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-parse-headers-2.0.3-5e8e7512383d140ba02f0c7aa9f49b4399c92515-integrity/node_modules/parse-headers/", {"name":"parse-headers","reference":"2.0.3"}],
  ["../../../yarn/v6/npm-xtend-4.0.2-bb72779f5fa465186b1f438f674fa347fdb5db54-integrity/node_modules/xtend/", {"name":"xtend","reference":"4.0.2"}],
  ["../../../yarn/v6/npm-pixelmatch-4.0.2-8f47dcec5011b477b67db03c243bc1f3085e8854-integrity/node_modules/pixelmatch/", {"name":"pixelmatch","reference":"4.0.2"}],
  ["../../../yarn/v6/npm-pngjs-3.4.0-99ca7d725965fb655814eaf65f38f12bbdbf555f-integrity/node_modules/pngjs/", {"name":"pngjs","reference":"3.4.0"}],
  ["../../../yarn/v6/npm-tinycolor2-1.4.1-f4fad333447bc0b07d4dc8e9209d8f39a8ac77e8-integrity/node_modules/tinycolor2/", {"name":"tinycolor2","reference":"1.4.1"}],
  ["../../../yarn/v6/npm-@jimp-plugins-0.9.3-bdff9d49484469c4d74ef47c2708e75773ca22b9-integrity/node_modules/@jimp/plugins/", {"name":"@jimp/plugins","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-blit-0.9.3-740346ac62ec0f7ae4458f5fd59c7582e630a8e8-integrity/node_modules/@jimp/plugin-blit/", {"name":"@jimp/plugin-blit","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-blur-0.9.3-9df505aaa63de138060264cf83ed4a98304bf105-integrity/node_modules/@jimp/plugin-blur/", {"name":"@jimp/plugin-blur","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-color-0.9.3-4a5ad28f68901355878f5330186c260f4f87f944-integrity/node_modules/@jimp/plugin-color/", {"name":"@jimp/plugin-color","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-contain-0.9.3-d0da9892edea25549611c88e125bfcc59045c426-integrity/node_modules/@jimp/plugin-contain/", {"name":"@jimp/plugin-contain","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-cover-0.9.3-2fca63620fcf8145bdecf315cf461588b09d9488-integrity/node_modules/@jimp/plugin-cover/", {"name":"@jimp/plugin-cover","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-crop-0.9.3-9b19c11293714a99c03d4b517ab597a5f88823e8-integrity/node_modules/@jimp/plugin-crop/", {"name":"@jimp/plugin-crop","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-displace-0.9.3-07645687b29ebc8a8491244410172795d511ba21-integrity/node_modules/@jimp/plugin-displace/", {"name":"@jimp/plugin-displace","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-dither-0.9.3-292b3ee617a5dcfe065d13b643055e910f8b6934-integrity/node_modules/@jimp/plugin-dither/", {"name":"@jimp/plugin-dither","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-flip-0.9.3-a755ffa1d860106067215987cbac213501d22b41-integrity/node_modules/@jimp/plugin-flip/", {"name":"@jimp/plugin-flip","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-gaussian-0.9.3-b10b5a5b4c37cb4edc3ed22a9b25294e68daf2f8-integrity/node_modules/@jimp/plugin-gaussian/", {"name":"@jimp/plugin-gaussian","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-invert-0.9.3-723a873133a1d62f9b93e023991f262c85917c78-integrity/node_modules/@jimp/plugin-invert/", {"name":"@jimp/plugin-invert","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-mask-0.9.3-6329ec861269244ab10ab9b3f54b1624c4ce0bab-integrity/node_modules/@jimp/plugin-mask/", {"name":"@jimp/plugin-mask","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-normalize-0.9.3-564155032d1b9dc567dbb7427a85606a25427c30-integrity/node_modules/@jimp/plugin-normalize/", {"name":"@jimp/plugin-normalize","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-print-0.9.3-b4470137312232de9b35eaf412cd753f999c58d8-integrity/node_modules/@jimp/plugin-print/", {"name":"@jimp/plugin-print","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-resize-0.9.3-916abd57c4f9b426984354c77555ade1efda7a82-integrity/node_modules/@jimp/plugin-resize/", {"name":"@jimp/plugin-resize","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-rotate-0.9.3-aa0d674c08726c0ae3ebc7f2adbfca0a927b1d9f-integrity/node_modules/@jimp/plugin-rotate/", {"name":"@jimp/plugin-rotate","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-plugin-scale-0.9.3-427fed7642883c27601aae33c25413980b6a2c50-integrity/node_modules/@jimp/plugin-scale/", {"name":"@jimp/plugin-scale","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-timm-1.6.2-dfd8c6719f7ba1fcfc6295a32670a1c6d166c0bd-integrity/node_modules/timm/", {"name":"timm","reference":"1.6.2"}],
  ["../../../yarn/v6/npm-@jimp-types-0.9.3-75337245a1a8c7c84a414beca3cfeded338c0ef1-integrity/node_modules/@jimp/types/", {"name":"@jimp/types","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-bmp-0.9.3-98eafc81674ce750f428ac9380007f1a4e90255e-integrity/node_modules/@jimp/bmp/", {"name":"@jimp/bmp","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-bmp-js-0.1.0-e05a63f796a6c1ff25f4771ec7adadc148c07233-integrity/node_modules/bmp-js/", {"name":"bmp-js","reference":"0.1.0"}],
  ["../../../yarn/v6/npm-@jimp-gif-0.9.3-b2b1a519092f94a913a955f252996f9a968930db-integrity/node_modules/@jimp/gif/", {"name":"@jimp/gif","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-omggif-1.0.10-ddaaf90d4a42f532e9e7cb3a95ecdd47f17c7b19-integrity/node_modules/omggif/", {"name":"omggif","reference":"1.0.10"}],
  ["../../../yarn/v6/npm-@jimp-jpeg-0.9.3-a759cb3bccf3cb163166873b9bdc0c949c5991b5-integrity/node_modules/@jimp/jpeg/", {"name":"@jimp/jpeg","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-jpeg-js-0.3.6-c40382aac9506e7d1f2d856eb02f6c7b2a98b37c-integrity/node_modules/jpeg-js/", {"name":"jpeg-js","reference":"0.3.6"}],
  ["../../../yarn/v6/npm-jpeg-js-0.1.2-135b992c0575c985cfa0f494a3227ed238583ece-integrity/node_modules/jpeg-js/", {"name":"jpeg-js","reference":"0.1.2"}],
  ["../../../yarn/v6/npm-@jimp-png-0.9.3-5c1bbb89b32e2332891a13efdb423e87287a8321-integrity/node_modules/@jimp/png/", {"name":"@jimp/png","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-@jimp-tiff-0.9.3-a4498c0616fb24034f5512b159b75b0aea389e9c-integrity/node_modules/@jimp/tiff/", {"name":"@jimp/tiff","reference":"0.9.3"}],
  ["../../../yarn/v6/npm-utif-2.0.1-9e1582d9bbd20011a6588548ed3266298e711759-integrity/node_modules/utif/", {"name":"utif","reference":"2.0.1"}],
  ["../../../yarn/v6/npm-pako-1.0.10-4328badb5086a426aa90f541977d4955da5c9732-integrity/node_modules/pako/", {"name":"pako","reference":"1.0.10"}],
  ["../../../yarn/v6/npm-js-yaml-3.13.1-aff151b30bfdfa8e49e05da22e7415e9dfa37847-integrity/node_modules/js-yaml/", {"name":"js-yaml","reference":"3.13.1"}],
  ["../../../yarn/v6/npm-argparse-1.0.10-bcd6791ea5ae09725e17e5ad988134cd40b3d911-integrity/node_modules/argparse/", {"name":"argparse","reference":"1.0.10"}],
  ["../../../yarn/v6/npm-sprintf-js-1.0.3-04e6926f662895354f3dd015203633b857297e2c-integrity/node_modules/sprintf-js/", {"name":"sprintf-js","reference":"1.0.3"}],
  ["../../../yarn/v6/npm-esprima-4.0.1-13b04cdb3e6c5d19df91ab6987a8695619b0aa71-integrity/node_modules/esprima/", {"name":"esprima","reference":"4.0.1"}],
  ["../../../yarn/v6/npm-mongoose-5.8.9-616ae9df4cd7f41f7d2d77d037ad94784485bd74-integrity/node_modules/mongoose/", {"name":"mongoose","reference":"5.8.9"}],
  ["../../../yarn/v6/npm-bson-1.1.3-aa82cb91f9a453aaa060d6209d0675114a8154d3-integrity/node_modules/bson/", {"name":"bson","reference":"1.1.3"}],
  ["../../../yarn/v6/npm-kareem-2.3.1-def12d9c941017fabfb00f873af95e9c99e1be87-integrity/node_modules/kareem/", {"name":"kareem","reference":"2.3.1"}],
  ["../../../yarn/v6/npm-mongodb-3.4.1-0d15e57e0ea0fc85b7a4fb9291b374c2e71652dc-integrity/node_modules/mongodb/", {"name":"mongodb","reference":"3.4.1"}],
  ["../../../yarn/v6/npm-require-optional-1.0.1-4cf35a4247f64ca3df8c2ef208cc494b1ca8fc2e-integrity/node_modules/require_optional/", {"name":"require_optional","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-resolve-from-2.0.0-9480ab20e94ffa1d9e80a804c7ea147611966b57-integrity/node_modules/resolve-from/", {"name":"resolve-from","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-resolve-from-4.0.0-4abcd852ad32dd7baabfe9b40e00a36db5f392e6-integrity/node_modules/resolve-from/", {"name":"resolve-from","reference":"4.0.0"}],
  ["../../../yarn/v6/npm-saslprep-1.0.3-4c02f946b56cf54297e347ba1093e7acac4cf226-integrity/node_modules/saslprep/", {"name":"saslprep","reference":"1.0.3"}],
  ["../../../yarn/v6/npm-sparse-bitfield-3.0.3-ff4ae6e68656056ba4b3e792ab3334d38273ca11-integrity/node_modules/sparse-bitfield/", {"name":"sparse-bitfield","reference":"3.0.3"}],
  ["../../../yarn/v6/npm-memory-pager-1.5.0-d8751655d22d384682741c972f2c3d6dfa3e66b5-integrity/node_modules/memory-pager/", {"name":"memory-pager","reference":"1.5.0"}],
  ["../../../yarn/v6/npm-mongoose-legacy-pluralize-1.0.2-3ba9f91fa507b5186d399fb40854bff18fb563e4-integrity/node_modules/mongoose-legacy-pluralize/", {"name":"mongoose-legacy-pluralize","reference":"1.0.2"}],
  ["../../../yarn/v6/npm-mpath-0.6.0-aa922029fca4f0f641f360e74c5c1b6a4c47078e-integrity/node_modules/mpath/", {"name":"mpath","reference":"0.6.0"}],
  ["../../../yarn/v6/npm-mquery-3.2.2-e1383a3951852ce23e37f619a9b350f1fb3664e7-integrity/node_modules/mquery/", {"name":"mquery","reference":"3.2.2"}],
  ["../../../yarn/v6/npm-bluebird-3.5.1-d9551f9de98f1fcda1e683d17ee91a0602ee2eb9-integrity/node_modules/bluebird/", {"name":"bluebird","reference":"3.5.1"}],
  ["../../../yarn/v6/npm-regexp-clone-1.0.0-222db967623277056260b992626354a04ce9bf63-integrity/node_modules/regexp-clone/", {"name":"regexp-clone","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-sliced-1.0.1-0b3a662b5d04c3177b1926bea82b03f837a2ef41-integrity/node_modules/sliced/", {"name":"sliced","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-sift-7.0.1-47d62c50b159d316f1372f8b53f9c10cd21a4b08-integrity/node_modules/sift/", {"name":"sift","reference":"7.0.1"}],
  ["../../../yarn/v6/npm-nanoid-2.1.9-edc71de7b16fc367bbb447c7a638ccebe07a17a1-integrity/node_modules/nanoid/", {"name":"nanoid","reference":"2.1.9"}],
  ["../../../yarn/v6/npm-png-to-jpeg-1.0.1-14362c6aaaec5ea6b52fa3504f5ecc760b4e7424-integrity/node_modules/png-to-jpeg/", {"name":"png-to-jpeg","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-pify-2.3.0-ed141a6ac043a849ea588498e7dca8b15330e90c-integrity/node_modules/pify/", {"name":"pify","reference":"2.3.0"}],
  ["../../../yarn/v6/npm-png-js-0.1.1-1cc7c212303acabe74263ec3ac78009580242d93-integrity/node_modules/png-js/", {"name":"png-js","reference":"0.1.1"}],
  ["./.pnp/unplugged/npm-sharp-0.24.0-1200f4bb36ccc2bb36a78f0bcba0302cf1f7a5fd-integrity/node_modules/sharp/", {"name":"sharp","reference":"0.24.0"}],
  ["../../../yarn/v6/npm-color-3.1.2-68148e7f85d41ad7649c5fa8c8106f098d229e10-integrity/node_modules/color/", {"name":"color","reference":"3.1.2"}],
  ["../../../yarn/v6/npm-color-3.0.0-d920b4328d534a3ac8295d68f7bd4ba6c427be9a-integrity/node_modules/color/", {"name":"color","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-color-string-1.5.3-c9bbc5f01b58b5492f3d6857459cb6590ce204cc-integrity/node_modules/color-string/", {"name":"color-string","reference":"1.5.3"}],
  ["../../../yarn/v6/npm-simple-swizzle-0.2.2-a4da6b635ffcccca33f70d17cb92592de95e557a-integrity/node_modules/simple-swizzle/", {"name":"simple-swizzle","reference":"0.2.2"}],
  ["../../../yarn/v6/npm-is-arrayish-0.3.2-4574a2ae56f7ab206896fb431eaeed066fdf8f03-integrity/node_modules/is-arrayish/", {"name":"is-arrayish","reference":"0.3.2"}],
  ["../../../yarn/v6/npm-is-arrayish-0.2.1-77c99840527aa8ecb1a8ba697b80645a7a926a9d-integrity/node_modules/is-arrayish/", {"name":"is-arrayish","reference":"0.2.1"}],
  ["../../../yarn/v6/npm-prebuild-install-5.3.3-ef4052baac60d465f5ba6bf003c9c1de79b9da8e-integrity/node_modules/prebuild-install/", {"name":"prebuild-install","reference":"5.3.3"}],
  ["../../../yarn/v6/npm-expand-template-2.0.3-6e14b3fcee0f3a6340ecb57d2e8918692052a47c-integrity/node_modules/expand-template/", {"name":"expand-template","reference":"2.0.3"}],
  ["../../../yarn/v6/npm-github-from-package-0.0.0-97fb5d96bfde8973313f20e8288ef9a167fa64ce-integrity/node_modules/github-from-package/", {"name":"github-from-package","reference":"0.0.0"}],
  ["../../../yarn/v6/npm-napi-build-utils-1.0.1-1381a0f92c39d66bf19852e7873432fc2123e508-integrity/node_modules/napi-build-utils/", {"name":"napi-build-utils","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-node-abi-2.13.0-e2f2ec444d0aca3ea1b3874b6de41d1665828f63-integrity/node_modules/node-abi/", {"name":"node-abi","reference":"2.13.0"}],
  ["../../../yarn/v6/npm-noop-logger-0.1.1-94a2b1633c4f1317553007d8966fd0e841b6a4c2-integrity/node_modules/noop-logger/", {"name":"noop-logger","reference":"0.1.1"}],
  ["../../../yarn/v6/npm-pump-3.0.0-b4a2116815bde2f4e1ea602354e8c75565107a64-integrity/node_modules/pump/", {"name":"pump","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-end-of-stream-1.4.4-5ae64a5f45057baf3626ec14da0ca5e4b2431eb0-integrity/node_modules/end-of-stream/", {"name":"end-of-stream","reference":"1.4.4"}],
  ["../../../yarn/v6/npm-tar-fs-2.0.0-677700fc0c8b337a78bee3623fdc235f21d7afad-integrity/node_modules/tar-fs/", {"name":"tar-fs","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-tar-stream-2.1.0-d1aaa3661f05b38b5acc9b7020efdca5179a2cc3-integrity/node_modules/tar-stream/", {"name":"tar-stream","reference":"2.1.0"}],
  ["../../../yarn/v6/npm-bl-3.0.0-3611ec00579fd18561754360b21e9f784500ff88-integrity/node_modules/bl/", {"name":"bl","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-fs-constants-1.0.0-6be0de9be998ce16af8afc24497b9ee9b7ccd9ad-integrity/node_modules/fs-constants/", {"name":"fs-constants","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-tunnel-agent-0.6.0-27a5dea06b36b04a0a9966774b290868f0fc40fd-integrity/node_modules/tunnel-agent/", {"name":"tunnel-agent","reference":"0.6.0"}],
  ["../../../yarn/v6/npm-which-pm-runs-1.0.0-670b3afbc552e0b55df6b7780ca74615f23ad1cb-integrity/node_modules/which-pm-runs/", {"name":"which-pm-runs","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-telegraf-3.35.0-edf454ef3239efa1b754c5cd24407d56863e586c-integrity/node_modules/telegraf/", {"name":"telegraf","reference":"3.35.0"}],
  ["../../../yarn/v6/npm-@types-node-13.1.8-1d590429fe8187a02707720ecf38a6fe46ce294b-integrity/node_modules/@types/node/", {"name":"@types/node","reference":"13.1.8"}],
  ["../../../yarn/v6/npm-module-alias-2.2.2-151cdcecc24e25739ff0aa6e51e1c5716974c0e0-integrity/node_modules/module-alias/", {"name":"module-alias","reference":"2.2.2"}],
  ["../../../yarn/v6/npm-node-fetch-2.6.0-e633456386d4aa55863f676a7ab0daa8fdecb0fd-integrity/node_modules/node-fetch/", {"name":"node-fetch","reference":"2.6.0"}],
  ["../../../yarn/v6/npm-sandwich-stream-2.0.2-6d1feb6cf7e9fe9fadb41513459a72c2e84000fa-integrity/node_modules/sandwich-stream/", {"name":"sandwich-stream","reference":"2.0.2"}],
  ["../../../yarn/v6/npm-telegram-typings-3.6.1-1288d547f8694b61f1c01c2993e295f3114d9e25-integrity/node_modules/telegram-typings/", {"name":"telegram-typings","reference":"3.6.1"}],
  ["../../../yarn/v6/npm-telegraf-i18n-6.6.0-d75a5247bd4b6678f051b370871fca9488c61952-integrity/node_modules/telegraf-i18n/", {"name":"telegraf-i18n","reference":"6.6.0"}],
  ["../../../yarn/v6/npm-compile-template-0.3.1-e581a08385c792609408d448187a5eaaf334b6b0-integrity/node_modules/compile-template/", {"name":"compile-template","reference":"0.3.1"}],
  ["../../../yarn/v6/npm-telegraf-session-redis-5.1.0-f0eb6ff4f433ba97c4ea6d7717c8886b5d347ddb-integrity/node_modules/telegraf-session-redis/", {"name":"telegraf-session-redis","reference":"5.1.0"}],
  ["../../../yarn/v6/npm-@types-redis-2.8.14-2ed46d0f923f7ccd63fbe73a46a1241e606cf716-integrity/node_modules/@types/redis/", {"name":"@types/redis","reference":"2.8.14"}],
  ["../../../yarn/v6/npm-redis-2.8.0-202288e3f58c49f6079d97af7a10e1303ae14b02-integrity/node_modules/redis/", {"name":"redis","reference":"2.8.0"}],
  ["../../../yarn/v6/npm-double-ended-queue-2.1.0-0-103d3527fd31528f40188130c841efdd78264e5c-integrity/node_modules/double-ended-queue/", {"name":"double-ended-queue","reference":"2.1.0-0"}],
  ["../../../yarn/v6/npm-redis-commands-1.5.0-80d2e20698fe688f227127ff9e5164a7dd17e785-integrity/node_modules/redis-commands/", {"name":"redis-commands","reference":"1.5.0"}],
  ["../../../yarn/v6/npm-redis-parser-2.6.0-52ed09dacac108f1a631c07e9b69941e7a19504b-integrity/node_modules/redis-parser/", {"name":"redis-parser","reference":"2.6.0"}],
  ["../../../yarn/v6/npm-telegraph-uploader-2.0.0-625d7af288c955564fa746ac47081186abd5173e-integrity/node_modules/telegraph-uploader/", {"name":"telegraph-uploader","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-form-data-2.5.1-f2cbec57b5e59e23716e128fe44d4e5dd23895f4-integrity/node_modules/form-data/", {"name":"form-data","reference":"2.5.1"}],
  ["../../../yarn/v6/npm-asynckit-0.4.0-c79ed97f7f34cb8f2ba1bc9790bcc366474b4b79-integrity/node_modules/asynckit/", {"name":"asynckit","reference":"0.4.0"}],
  ["../../../yarn/v6/npm-combined-stream-1.0.8-c3d45a8b34fd730631a110a8a2520682b31d5a7f-integrity/node_modules/combined-stream/", {"name":"combined-stream","reference":"1.0.8"}],
  ["../../../yarn/v6/npm-delayed-stream-1.0.0-df3ae199acadfb7d440aaae0b29e2272b24ec619-integrity/node_modules/delayed-stream/", {"name":"delayed-stream","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-mime-types-2.1.26-9c921fc09b7e149a65dfdc0da4d20997200b0a06-integrity/node_modules/mime-types/", {"name":"mime-types","reference":"2.1.26"}],
  ["../../../yarn/v6/npm-mime-db-1.43.0-0a12e0502650e473d735535050e7c8f4eb4fae58-integrity/node_modules/mime-db/", {"name":"mime-db","reference":"1.43.0"}],
  ["../../../yarn/v6/npm-is-buffer-2.0.4-3e572f23c8411a5cfd9557c849e3665e0b290623-integrity/node_modules/is-buffer/", {"name":"is-buffer","reference":"2.0.4"}],
  ["../../../yarn/v6/npm-isstream-0.1.2-47e63f7af55afa6f92e1500e690eb8b8529c099a-integrity/node_modules/isstream/", {"name":"isstream","reference":"0.1.2"}],
  ["../../../yarn/v6/npm-stream-to-array-2.3.0-bbf6b39f5f43ec30bc71babcb37557acecf34353-integrity/node_modules/stream-to-array/", {"name":"stream-to-array","reference":"2.3.0"}],
  ["../../../yarn/v6/npm-any-promise-1.3.0-abc6afeedcea52e809cdc0376aed3ce39635d17f-integrity/node_modules/any-promise/", {"name":"any-promise","reference":"1.3.0"}],
  ["../../../yarn/v6/npm-winston-3.2.1-63061377976c73584028be2490a1846055f77f07-integrity/node_modules/winston/", {"name":"winston","reference":"3.2.1"}],
  ["../../../yarn/v6/npm-async-2.6.3-d72625e2344a3656e3a3ad4fa749fa83299d82ff-integrity/node_modules/async/", {"name":"async","reference":"2.6.3"}],
  ["../../../yarn/v6/npm-lodash-4.17.15-b447f6670a0455bbfeedd11392eff330ea097548-integrity/node_modules/lodash/", {"name":"lodash","reference":"4.17.15"}],
  ["../../../yarn/v6/npm-diagnostics-1.1.1-cab6ac33df70c9d9a727490ae43ac995a769b22a-integrity/node_modules/diagnostics/", {"name":"diagnostics","reference":"1.1.1"}],
  ["../../../yarn/v6/npm-colorspace-1.1.2-e0128950d082b86a2168580796a0aa5d6c68d8c5-integrity/node_modules/colorspace/", {"name":"colorspace","reference":"1.1.2"}],
  ["../../../yarn/v6/npm-text-hex-1.0.0-69dc9c1b17446ee79a92bf5b884bb4b9127506f5-integrity/node_modules/text-hex/", {"name":"text-hex","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-enabled-1.0.2-965f6513d2c2d1c5f4652b64a2e3396467fc2f93-integrity/node_modules/enabled/", {"name":"enabled","reference":"1.0.2"}],
  ["../../../yarn/v6/npm-env-variable-0.0.5-913dd830bef11e96a039c038d4130604eba37f88-integrity/node_modules/env-variable/", {"name":"env-variable","reference":"0.0.5"}],
  ["../../../yarn/v6/npm-kuler-1.0.1-ef7c784f36c9fb6e16dd3150d152677b2b0228a6-integrity/node_modules/kuler/", {"name":"kuler","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-colornames-1.1.1-f8889030685c7c4ff9e2a559f5077eb76a816f96-integrity/node_modules/colornames/", {"name":"colornames","reference":"1.1.1"}],
  ["../../../yarn/v6/npm-is-stream-1.1.0-12d4a3dd4e68e0b79ceb8dbc84173ae80d91ca44-integrity/node_modules/is-stream/", {"name":"is-stream","reference":"1.1.0"}],
  ["../../../yarn/v6/npm-logform-2.1.2-957155ebeb67a13164069825ce67ddb5bb2dd360-integrity/node_modules/logform/", {"name":"logform","reference":"2.1.2"}],
  ["../../../yarn/v6/npm-colors-1.4.0-c50491479d4c1bdaed2c9ced32cf7c7dc2360f78-integrity/node_modules/colors/", {"name":"colors","reference":"1.4.0"}],
  ["../../../yarn/v6/npm-fast-safe-stringify-2.0.7-124aa885899261f68aedb42a7c080de9da608743-integrity/node_modules/fast-safe-stringify/", {"name":"fast-safe-stringify","reference":"2.0.7"}],
  ["../../../yarn/v6/npm-fecha-2.3.3-948e74157df1a32fd1b12c3a3c3cdcb6ec9d96cd-integrity/node_modules/fecha/", {"name":"fecha","reference":"2.3.3"}],
  ["../../../yarn/v6/npm-triple-beam-1.3.0-a595214c7298db8339eeeee083e4d10bd8cb8dd9-integrity/node_modules/triple-beam/", {"name":"triple-beam","reference":"1.3.0"}],
  ["../../../yarn/v6/npm-one-time-0.0.4-f8cdf77884826fe4dff93e3a9cc37b1e4480742e-integrity/node_modules/one-time/", {"name":"one-time","reference":"0.0.4"}],
  ["../../../yarn/v6/npm-stack-trace-0.0.10-547c70b347e8d32b4e108ea1a2a159e5fdde19c0-integrity/node_modules/stack-trace/", {"name":"stack-trace","reference":"0.0.10"}],
  ["../../../yarn/v6/npm-winston-transport-4.3.0-df68c0c202482c448d9b47313c07304c2d7c2c66-integrity/node_modules/winston-transport/", {"name":"winston-transport","reference":"4.3.0"}],
  ["../../../yarn/v6/npm-eslint-6.8.0-62262d6729739f9275723824302fb227c8c93ffb-integrity/node_modules/eslint/", {"name":"eslint","reference":"6.8.0"}],
  ["../../../yarn/v6/npm-@babel-code-frame-7.8.3-33e25903d7481181534e12ec0a25f16b6fcf419e-integrity/node_modules/@babel/code-frame/", {"name":"@babel/code-frame","reference":"7.8.3"}],
  ["../../../yarn/v6/npm-@babel-highlight-7.8.3-28f173d04223eaaa59bc1d439a3836e6d1265797-integrity/node_modules/@babel/highlight/", {"name":"@babel/highlight","reference":"7.8.3"}],
  ["../../../yarn/v6/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64-integrity/node_modules/esutils/", {"name":"esutils","reference":"2.0.3"}],
  ["../../../yarn/v6/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499-integrity/node_modules/js-tokens/", {"name":"js-tokens","reference":"4.0.0"}],
  ["../../../yarn/v6/npm-ajv-6.11.0-c3607cbc8ae392d8a5a536f25b21f8e5f3f87fe9-integrity/node_modules/ajv/", {"name":"ajv","reference":"6.11.0"}],
  ["../../../yarn/v6/npm-fast-deep-equal-3.1.1-545145077c501491e33b15ec408c294376e94ae4-integrity/node_modules/fast-deep-equal/", {"name":"fast-deep-equal","reference":"3.1.1"}],
  ["../../../yarn/v6/npm-fast-json-stable-stringify-2.1.0-874bf69c6f404c2b5d99c481341399fd55892633-integrity/node_modules/fast-json-stable-stringify/", {"name":"fast-json-stable-stringify","reference":"2.1.0"}],
  ["../../../yarn/v6/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660-integrity/node_modules/json-schema-traverse/", {"name":"json-schema-traverse","reference":"0.4.1"}],
  ["../../../yarn/v6/npm-uri-js-4.2.2-94c540e1ff772956e2299507c010aea6c8838eb0-integrity/node_modules/uri-js/", {"name":"uri-js","reference":"4.2.2"}],
  ["../../../yarn/v6/npm-punycode-2.1.1-b58b010ac40c22c5657616c8d2c2c02c7bf479ec-integrity/node_modules/punycode/", {"name":"punycode","reference":"2.1.1"}],
  ["../../../yarn/v6/npm-cross-spawn-6.0.5-4a5ec7c64dfae22c3a14124dbacdee846d80cbc4-integrity/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"6.0.5"}],
  ["../../../yarn/v6/npm-nice-try-1.0.5-a3378a7696ce7d223e88fc9b764bd7ef1089e366-integrity/node_modules/nice-try/", {"name":"nice-try","reference":"1.0.5"}],
  ["../../../yarn/v6/npm-path-key-2.0.1-411cadb574c5a140d3a4b1910d40d80cc9f40b40-integrity/node_modules/path-key/", {"name":"path-key","reference":"2.0.1"}],
  ["../../../yarn/v6/npm-shebang-command-1.2.0-44aac65b695b03398968c39f363fee5deafdf1ea-integrity/node_modules/shebang-command/", {"name":"shebang-command","reference":"1.2.0"}],
  ["../../../yarn/v6/npm-shebang-regex-1.0.0-da42f49740c0b42db2ca9728571cb190c98efea3-integrity/node_modules/shebang-regex/", {"name":"shebang-regex","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-which-1.3.1-a45043d54f5805316da8d62f9f50918d3da70b0a-integrity/node_modules/which/", {"name":"which","reference":"1.3.1"}],
  ["../../../yarn/v6/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10-integrity/node_modules/isexe/", {"name":"isexe","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-doctrine-3.0.0-addebead72a6574db783639dc87a121773973961-integrity/node_modules/doctrine/", {"name":"doctrine","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-doctrine-1.5.0-379dce730f6166f76cefa4e6707a159b02c5a6fa-integrity/node_modules/doctrine/", {"name":"doctrine","reference":"1.5.0"}],
  ["../../../yarn/v6/npm-eslint-scope-5.0.0-e87c8887c73e8d1ec84f1ca591645c358bfc8fb9-integrity/node_modules/eslint-scope/", {"name":"eslint-scope","reference":"5.0.0"}],
  ["../../../yarn/v6/npm-esrecurse-4.2.1-007a3b9fdbc2b3bb87e4879ea19c92fdbd3942cf-integrity/node_modules/esrecurse/", {"name":"esrecurse","reference":"4.2.1"}],
  ["../../../yarn/v6/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d-integrity/node_modules/estraverse/", {"name":"estraverse","reference":"4.3.0"}],
  ["../../../yarn/v6/npm-eslint-utils-1.4.3-74fec7c54d0776b6f67e0251040b5806564e981f-integrity/node_modules/eslint-utils/", {"name":"eslint-utils","reference":"1.4.3"}],
  ["../../../yarn/v6/npm-eslint-visitor-keys-1.1.0-e2a82cea84ff246ad6fb57f9bde5b46621459ec2-integrity/node_modules/eslint-visitor-keys/", {"name":"eslint-visitor-keys","reference":"1.1.0"}],
  ["../../../yarn/v6/npm-espree-6.1.2-6c272650932b4f91c3714e5e7b5f5e2ecf47262d-integrity/node_modules/espree/", {"name":"espree","reference":"6.1.2"}],
  ["../../../yarn/v6/npm-acorn-7.1.0-949d36f2c292535da602283586c2477c57eb2d6c-integrity/node_modules/acorn/", {"name":"acorn","reference":"7.1.0"}],
  ["../../../yarn/v6/npm-acorn-jsx-5.1.0-294adb71b57398b0680015f0a38c563ee1db5384-integrity/node_modules/acorn-jsx/", {"name":"acorn-jsx","reference":"5.1.0"}],
  ["../../../yarn/v6/npm-esquery-1.0.1-406c51658b1f5991a5f9b62b1dc25b00e3e5c708-integrity/node_modules/esquery/", {"name":"esquery","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-file-entry-cache-5.0.1-ca0f6efa6dd3d561333fb14515065c2fafdf439c-integrity/node_modules/file-entry-cache/", {"name":"file-entry-cache","reference":"5.0.1"}],
  ["../../../yarn/v6/npm-flat-cache-2.0.1-5d296d6f04bda44a4630a301413bdbc2ec085ec0-integrity/node_modules/flat-cache/", {"name":"flat-cache","reference":"2.0.1"}],
  ["../../../yarn/v6/npm-flatted-2.0.1-69e57caa8f0eacbc281d2e2cb458d46fdb449e08-integrity/node_modules/flatted/", {"name":"flatted","reference":"2.0.1"}],
  ["../../../yarn/v6/npm-write-1.0.3-0800e14523b923a387e415123c865616aae0f5c3-integrity/node_modules/write/", {"name":"write","reference":"1.0.3"}],
  ["../../../yarn/v6/npm-functional-red-black-tree-1.0.1-1b0ab3bd553b2a0d6399d29c0e3ea0b252078327-integrity/node_modules/functional-red-black-tree/", {"name":"functional-red-black-tree","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-glob-parent-5.1.0-5f4c1d1e748d30cd73ad2944b3577a81b081e8c2-integrity/node_modules/glob-parent/", {"name":"glob-parent","reference":"5.1.0"}],
  ["../../../yarn/v6/npm-is-glob-4.0.1-7567dbe9f2f5e2467bc77ab83c4a29482407a5dc-integrity/node_modules/is-glob/", {"name":"is-glob","reference":"4.0.1"}],
  ["../../../yarn/v6/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2-integrity/node_modules/is-extglob/", {"name":"is-extglob","reference":"2.1.1"}],
  ["../../../yarn/v6/npm-globals-12.3.0-1e564ee5c4dded2ab098b0f88f24702a3c56be13-integrity/node_modules/globals/", {"name":"globals","reference":"12.3.0"}],
  ["../../../yarn/v6/npm-type-fest-0.8.1-09e249ebde851d3b1e48d27c105444667f17b83d-integrity/node_modules/type-fest/", {"name":"type-fest","reference":"0.8.1"}],
  ["../../../yarn/v6/npm-ignore-4.0.6-750e3db5862087b4737ebac8207ffd1ef27b25fc-integrity/node_modules/ignore/", {"name":"ignore","reference":"4.0.6"}],
  ["../../../yarn/v6/npm-import-fresh-3.2.1-633ff618506e793af5ac91bf48b72677e15cbe66-integrity/node_modules/import-fresh/", {"name":"import-fresh","reference":"3.2.1"}],
  ["../../../yarn/v6/npm-parent-module-1.0.1-691d2709e78c79fae3a156622452d00762caaaa2-integrity/node_modules/parent-module/", {"name":"parent-module","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-callsites-3.1.0-b3630abd8943432f54b3f0519238e33cd7df2f73-integrity/node_modules/callsites/", {"name":"callsites","reference":"3.1.0"}],
  ["../../../yarn/v6/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea-integrity/node_modules/imurmurhash/", {"name":"imurmurhash","reference":"0.1.4"}],
  ["../../../yarn/v6/npm-inquirer-7.0.3-f9b4cd2dff58b9f73e8d43759436ace15bed4567-integrity/node_modules/inquirer/", {"name":"inquirer","reference":"7.0.3"}],
  ["../../../yarn/v6/npm-ansi-escapes-4.3.0-a4ce2b33d6b214b7950d8595c212f12ac9cc569d-integrity/node_modules/ansi-escapes/", {"name":"ansi-escapes","reference":"4.3.0"}],
  ["../../../yarn/v6/npm-cli-cursor-3.1.0-264305a7ae490d1d03bf0c9ba7c925d1753af307-integrity/node_modules/cli-cursor/", {"name":"cli-cursor","reference":"3.1.0"}],
  ["../../../yarn/v6/npm-restore-cursor-3.1.0-39f67c54b3a7a58cea5236d95cf0034239631f7e-integrity/node_modules/restore-cursor/", {"name":"restore-cursor","reference":"3.1.0"}],
  ["../../../yarn/v6/npm-onetime-5.1.0-fff0f3c91617fe62bb50189636e99ac8a6df7be5-integrity/node_modules/onetime/", {"name":"onetime","reference":"5.1.0"}],
  ["../../../yarn/v6/npm-mimic-fn-2.1.0-7ed2c2ccccaf84d3ffcb7a69b57711fc2083401b-integrity/node_modules/mimic-fn/", {"name":"mimic-fn","reference":"2.1.0"}],
  ["../../../yarn/v6/npm-cli-width-2.2.0-ff19ede8a9a5e579324147b0c11f0fbcbabed639-integrity/node_modules/cli-width/", {"name":"cli-width","reference":"2.2.0"}],
  ["../../../yarn/v6/npm-external-editor-3.1.0-cb03f740befae03ea4d283caed2741a83f335495-integrity/node_modules/external-editor/", {"name":"external-editor","reference":"3.1.0"}],
  ["../../../yarn/v6/npm-chardet-0.7.0-90094849f0937f2eedc2425d0d28a9e5f0cbad9e-integrity/node_modules/chardet/", {"name":"chardet","reference":"0.7.0"}],
  ["../../../yarn/v6/npm-tmp-0.0.33-6d34335889768d21b2bcda0aa277ced3b1bfadf9-integrity/node_modules/tmp/", {"name":"tmp","reference":"0.0.33"}],
  ["../../../yarn/v6/npm-figures-3.1.0-4b198dd07d8d71530642864af2d45dd9e459c4ec-integrity/node_modules/figures/", {"name":"figures","reference":"3.1.0"}],
  ["../../../yarn/v6/npm-mute-stream-0.0.8-1630c42b2251ff81e2a283de96a5497ea92e5e0d-integrity/node_modules/mute-stream/", {"name":"mute-stream","reference":"0.0.8"}],
  ["../../../yarn/v6/npm-run-async-2.3.0-0371ab4ae0bdd720d4166d7dfda64ff7a445a6c0-integrity/node_modules/run-async/", {"name":"run-async","reference":"2.3.0"}],
  ["../../../yarn/v6/npm-is-promise-2.1.0-79a2a9ece7f096e80f36d2b2f3bc16c1ff4bf3fa-integrity/node_modules/is-promise/", {"name":"is-promise","reference":"2.1.0"}],
  ["../../../yarn/v6/npm-rxjs-6.5.4-e0777fe0d184cec7872df147f303572d414e211c-integrity/node_modules/rxjs/", {"name":"rxjs","reference":"6.5.4"}],
  ["../../../yarn/v6/npm-tslib-1.10.0-c3c19f95973fb0a62973fb09d90d961ee43e5c8a-integrity/node_modules/tslib/", {"name":"tslib","reference":"1.10.0"}],
  ["../../../yarn/v6/npm-emoji-regex-8.0.0-e818fd69ce5ccfcb404594f842963bf53164cc37-integrity/node_modules/emoji-regex/", {"name":"emoji-regex","reference":"8.0.0"}],
  ["../../../yarn/v6/npm-emoji-regex-7.0.3-933a04052860c85e83c122479c4748a8e4c72156-integrity/node_modules/emoji-regex/", {"name":"emoji-regex","reference":"7.0.3"}],
  ["../../../yarn/v6/npm-through-2.3.8-0dd4c9ffaabc357960b1b724115d7e0e86a2e1f5-integrity/node_modules/through/", {"name":"through","reference":"2.3.8"}],
  ["../../../yarn/v6/npm-json-stable-stringify-without-jsonify-1.0.1-9db7b59496ad3f3cfef30a75142d2d930ad72651-integrity/node_modules/json-stable-stringify-without-jsonify/", {"name":"json-stable-stringify-without-jsonify","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-levn-0.3.0-3b09924edf9f083c0490fdd4c0bc4421e04764ee-integrity/node_modules/levn/", {"name":"levn","reference":"0.3.0"}],
  ["../../../yarn/v6/npm-prelude-ls-1.1.2-21932a549f5e52ffd9a827f570e04be62a97da54-integrity/node_modules/prelude-ls/", {"name":"prelude-ls","reference":"1.1.2"}],
  ["../../../yarn/v6/npm-type-check-0.3.2-5884cab512cf1d355e3fb784f30804b2b520db72-integrity/node_modules/type-check/", {"name":"type-check","reference":"0.3.2"}],
  ["../../../yarn/v6/npm-natural-compare-1.4.0-4abebfeed7541f2c27acfb29bdbbd15c8d5ba4f7-integrity/node_modules/natural-compare/", {"name":"natural-compare","reference":"1.4.0"}],
  ["../../../yarn/v6/npm-optionator-0.8.3-84fa1d036fe9d3c7e21d99884b601167ec8fb495-integrity/node_modules/optionator/", {"name":"optionator","reference":"0.8.3"}],
  ["../../../yarn/v6/npm-deep-is-0.1.3-b369d6fb5dbc13eecf524f91b070feedc357cf34-integrity/node_modules/deep-is/", {"name":"deep-is","reference":"0.1.3"}],
  ["../../../yarn/v6/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917-integrity/node_modules/fast-levenshtein/", {"name":"fast-levenshtein","reference":"2.0.6"}],
  ["../../../yarn/v6/npm-word-wrap-1.2.3-610636f6b1f703891bd34771ccb17fb93b47079c-integrity/node_modules/word-wrap/", {"name":"word-wrap","reference":"1.2.3"}],
  ["../../../yarn/v6/npm-progress-2.0.3-7e8cf8d8f5b8f239c1bc68beb4eb78567d572ef8-integrity/node_modules/progress/", {"name":"progress","reference":"2.0.3"}],
  ["../../../yarn/v6/npm-regexpp-2.0.1-8d19d31cf632482b589049f8281f93dbcba4d07f-integrity/node_modules/regexpp/", {"name":"regexpp","reference":"2.0.1"}],
  ["../../../yarn/v6/npm-table-5.4.6-1292d19500ce3f86053b05f0e8e7e4a3bb21079e-integrity/node_modules/table/", {"name":"table","reference":"5.4.6"}],
  ["../../../yarn/v6/npm-slice-ansi-2.1.0-cacd7693461a637a5788d92a7dd4fba068e81636-integrity/node_modules/slice-ansi/", {"name":"slice-ansi","reference":"2.1.0"}],
  ["../../../yarn/v6/npm-astral-regex-1.0.0-6c8c3fb827dd43ee3918f27b82782ab7658a6fd9-integrity/node_modules/astral-regex/", {"name":"astral-regex","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-text-table-0.2.0-7f5ee823ae805207c00af2df4a84ec3fcfa570b4-integrity/node_modules/text-table/", {"name":"text-table","reference":"0.2.0"}],
  ["../../../yarn/v6/npm-v8-compile-cache-2.1.0-e14de37b31a6d194f5690d67efc4e7f6fc6ab30e-integrity/node_modules/v8-compile-cache/", {"name":"v8-compile-cache","reference":"2.1.0"}],
  ["../../../yarn/v6/npm-eslint-config-airbnb-base-13.2.0-f6ea81459ff4dec2dda200c35f1d8f7419d57943-integrity/node_modules/eslint-config-airbnb-base/", {"name":"eslint-config-airbnb-base","reference":"13.2.0"}],
  ["../../../yarn/v6/npm-confusing-browser-globals-1.0.9-72bc13b483c0276801681871d4898516f8f54fdd-integrity/node_modules/confusing-browser-globals/", {"name":"confusing-browser-globals","reference":"1.0.9"}],
  ["../../../yarn/v6/npm-object-assign-4.1.0-968bf1100d7956bb3ca086f006f846b3bc4008da-integrity/node_modules/object.assign/", {"name":"object.assign","reference":"4.1.0"}],
  ["../../../yarn/v6/npm-define-properties-1.1.3-cf88da6cbee26fe6db7094f61d870cbd84cee9f1-integrity/node_modules/define-properties/", {"name":"define-properties","reference":"1.1.3"}],
  ["../../../yarn/v6/npm-object-keys-1.1.1-1c47f272df277f3b1daf061677d9c82e2322c60e-integrity/node_modules/object-keys/", {"name":"object-keys","reference":"1.1.1"}],
  ["../../../yarn/v6/npm-function-bind-1.1.1-a56899d3ea3c9bab874bb9773b7c5ede92f4895d-integrity/node_modules/function-bind/", {"name":"function-bind","reference":"1.1.1"}],
  ["../../../yarn/v6/npm-has-symbols-1.0.1-9f5214758a44196c406d9bd76cebf81ec2dd31e8-integrity/node_modules/has-symbols/", {"name":"has-symbols","reference":"1.0.1"}],
  ["../../../yarn/v6/npm-object-entries-1.1.1-ee1cf04153de02bb093fec33683900f57ce5399b-integrity/node_modules/object.entries/", {"name":"object.entries","reference":"1.1.1"}],
  ["../../../yarn/v6/npm-es-abstract-1.17.3-d921ff5889a3664921094bb13aaf0dfd11818578-integrity/node_modules/es-abstract/", {"name":"es-abstract","reference":"1.17.3"}],
  ["../../../yarn/v6/npm-es-to-primitive-1.2.1-e55cd4c9cdc188bcefb03b366c736323fc5c898a-integrity/node_modules/es-to-primitive/", {"name":"es-to-primitive","reference":"1.2.1"}],
  ["../../../yarn/v6/npm-is-callable-1.1.5-f7e46b596890456db74e7f6e976cb3273d06faab-integrity/node_modules/is-callable/", {"name":"is-callable","reference":"1.1.5"}],
  ["../../../yarn/v6/npm-is-date-object-1.0.2-bda736f2cd8fd06d32844e7743bfa7494c3bfd7e-integrity/node_modules/is-date-object/", {"name":"is-date-object","reference":"1.0.2"}],
  ["../../../yarn/v6/npm-is-symbol-1.0.3-38e1014b9e6329be0de9d24a414fd7441ec61937-integrity/node_modules/is-symbol/", {"name":"is-symbol","reference":"1.0.3"}],
  ["../../../yarn/v6/npm-has-1.0.3-722d7cbfc1f6aa8241f16dd814e011e1f41e8796-integrity/node_modules/has/", {"name":"has","reference":"1.0.3"}],
  ["../../../yarn/v6/npm-is-regex-1.0.5-39d589a358bf18967f726967120b8fc1aed74eae-integrity/node_modules/is-regex/", {"name":"is-regex","reference":"1.0.5"}],
  ["../../../yarn/v6/npm-object-inspect-1.7.0-f4f6bd181ad77f006b5ece60bd0b6f398ff74a67-integrity/node_modules/object-inspect/", {"name":"object-inspect","reference":"1.7.0"}],
  ["../../../yarn/v6/npm-string-prototype-trimleft-2.1.1-9bdb8ac6abd6d602b17a4ed321870d2f8dcefc74-integrity/node_modules/string.prototype.trimleft/", {"name":"string.prototype.trimleft","reference":"2.1.1"}],
  ["../../../yarn/v6/npm-string-prototype-trimright-2.1.1-440314b15996c866ce8a0341894d45186200c5d9-integrity/node_modules/string.prototype.trimright/", {"name":"string.prototype.trimright","reference":"2.1.1"}],
  ["../../../yarn/v6/npm-eslint-plugin-import-2.20.0-d749a7263fb6c29980def8e960d380a6aa6aecaa-integrity/node_modules/eslint-plugin-import/", {"name":"eslint-plugin-import","reference":"2.20.0"}],
  ["../../../yarn/v6/npm-array-includes-3.1.1-cdd67e6852bdf9c1215460786732255ed2459348-integrity/node_modules/array-includes/", {"name":"array-includes","reference":"3.1.1"}],
  ["../../../yarn/v6/npm-is-string-1.0.5-40493ed198ef3ff477b8c7f92f644ec82a5cd3a6-integrity/node_modules/is-string/", {"name":"is-string","reference":"1.0.5"}],
  ["../../../yarn/v6/npm-array-prototype-flat-1.2.3-0de82b426b0318dbfdb940089e38b043d37f6c7b-integrity/node_modules/array.prototype.flat/", {"name":"array.prototype.flat","reference":"1.2.3"}],
  ["../../../yarn/v6/npm-contains-path-0.1.0-fe8cf184ff6670b6baef01a9d4861a5cbec4120a-integrity/node_modules/contains-path/", {"name":"contains-path","reference":"0.1.0"}],
  ["../../../yarn/v6/npm-eslint-import-resolver-node-0.3.3-dbaa52b6b2816b50bc6711af75422de808e98404-integrity/node_modules/eslint-import-resolver-node/", {"name":"eslint-import-resolver-node","reference":"0.3.3"}],
  ["../../../yarn/v6/npm-resolve-1.14.2-dbf31d0fa98b1f29aa5169783b9c290cb865fea2-integrity/node_modules/resolve/", {"name":"resolve","reference":"1.14.2"}],
  ["../../../yarn/v6/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c-integrity/node_modules/path-parse/", {"name":"path-parse","reference":"1.0.6"}],
  ["../../../yarn/v6/npm-eslint-module-utils-2.5.2-7878f7504824e1b857dd2505b59a8e5eda26a708-integrity/node_modules/eslint-module-utils/", {"name":"eslint-module-utils","reference":"2.5.2"}],
  ["../../../yarn/v6/npm-pkg-dir-2.0.0-f6d5d1109e19d63edf428e0bd57e12777615334b-integrity/node_modules/pkg-dir/", {"name":"pkg-dir","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-find-up-2.1.0-45d1b7e506c717ddd482775a2b77920a3c0c57a7-integrity/node_modules/find-up/", {"name":"find-up","reference":"2.1.0"}],
  ["../../../yarn/v6/npm-locate-path-2.0.0-2b568b265eec944c6d9c0de9c3dbbbca0354cd8e-integrity/node_modules/locate-path/", {"name":"locate-path","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-p-locate-2.0.0-20a0103b222a70c8fd39cc2e580680f3dde5ec43-integrity/node_modules/p-locate/", {"name":"p-locate","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-p-limit-1.3.0-b86bd5f0c25690911c7590fcbfc2010d54b3ccb8-integrity/node_modules/p-limit/", {"name":"p-limit","reference":"1.3.0"}],
  ["../../../yarn/v6/npm-p-try-1.0.0-cbc79cdbaf8fd4228e13f621f2b1a237c1b207b3-integrity/node_modules/p-try/", {"name":"p-try","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-path-exists-3.0.0-ce0ebeaa5f78cb18925ea7d810d7b59b010fd515-integrity/node_modules/path-exists/", {"name":"path-exists","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-object-values-1.1.1-68a99ecde356b7e9295a3c5e0ce31dc8c953de5e-integrity/node_modules/object.values/", {"name":"object.values","reference":"1.1.1"}],
  ["../../../yarn/v6/npm-read-pkg-up-2.0.0-6b72a8048984e0c41e79510fd5e9fa99b3b549be-integrity/node_modules/read-pkg-up/", {"name":"read-pkg-up","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-read-pkg-2.0.0-8ef1c0623c6a6db0dc6713c4bfac46332b2368f8-integrity/node_modules/read-pkg/", {"name":"read-pkg","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-load-json-file-2.0.0-7947e42149af80d696cbf797bcaabcfe1fe29ca8-integrity/node_modules/load-json-file/", {"name":"load-json-file","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-graceful-fs-4.2.3-4a12ff1b60376ef09862c2093edd908328be8423-integrity/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.2.3"}],
  ["../../../yarn/v6/npm-parse-json-2.2.0-f480f40434ef80741f8469099f8dea18f55a4dc9-integrity/node_modules/parse-json/", {"name":"parse-json","reference":"2.2.0"}],
  ["../../../yarn/v6/npm-error-ex-1.3.2-b4ac40648107fdcdcfae242f428bea8a14d4f1bf-integrity/node_modules/error-ex/", {"name":"error-ex","reference":"1.3.2"}],
  ["../../../yarn/v6/npm-strip-bom-3.0.0-2334c18e9c759f7bdd56fdef7e9ae3d588e68ed3-integrity/node_modules/strip-bom/", {"name":"strip-bom","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-normalize-package-data-2.5.0-e66db1838b200c1dfc233225d12cb36520e234a8-integrity/node_modules/normalize-package-data/", {"name":"normalize-package-data","reference":"2.5.0"}],
  ["../../../yarn/v6/npm-hosted-git-info-2.8.5-759cfcf2c4d156ade59b0b2dfabddc42a6b9c70c-integrity/node_modules/hosted-git-info/", {"name":"hosted-git-info","reference":"2.8.5"}],
  ["../../../yarn/v6/npm-validate-npm-package-license-3.0.4-fc91f6b9c7ba15c857f4cb2c5defeec39d4f410a-integrity/node_modules/validate-npm-package-license/", {"name":"validate-npm-package-license","reference":"3.0.4"}],
  ["../../../yarn/v6/npm-spdx-correct-3.1.0-fb83e504445268f154b074e218c87c003cd31df4-integrity/node_modules/spdx-correct/", {"name":"spdx-correct","reference":"3.1.0"}],
  ["../../../yarn/v6/npm-spdx-expression-parse-3.0.0-99e119b7a5da00e05491c9fa338b7904823b41d0-integrity/node_modules/spdx-expression-parse/", {"name":"spdx-expression-parse","reference":"3.0.0"}],
  ["../../../yarn/v6/npm-spdx-exceptions-2.2.0-2ea450aee74f2a89bfb94519c07fcd6f41322977-integrity/node_modules/spdx-exceptions/", {"name":"spdx-exceptions","reference":"2.2.0"}],
  ["../../../yarn/v6/npm-spdx-license-ids-3.0.5-3694b5804567a458d3c8045842a6358632f62654-integrity/node_modules/spdx-license-ids/", {"name":"spdx-license-ids","reference":"3.0.5"}],
  ["../../../yarn/v6/npm-path-type-2.0.0-f012ccb8415b7096fc2daa1054c3d72389594c73-integrity/node_modules/path-type/", {"name":"path-type","reference":"2.0.0"}],
  ["../../../yarn/v6/npm-eslint-plugin-unicorn-9.1.1-1588a0473f9a0e37cfbbcf7552065a0b0a96ce26-integrity/node_modules/eslint-plugin-unicorn/", {"name":"eslint-plugin-unicorn","reference":"9.1.1"}],
  ["../../../yarn/v6/npm-clean-regexp-1.0.0-8df7c7aae51fd36874e8f8d05b9180bc11a3fed7-integrity/node_modules/clean-regexp/", {"name":"clean-regexp","reference":"1.0.0"}],
  ["../../../yarn/v6/npm-eslint-ast-utils-1.1.0-3d58ba557801cfb1c941d68131ee9f8c34bd1586-integrity/node_modules/eslint-ast-utils/", {"name":"eslint-ast-utils","reference":"1.1.0"}],
  ["../../../yarn/v6/npm-lodash-get-4.4.2-2d177f652fa31e939b4438d5341499dfa3825e99-integrity/node_modules/lodash.get/", {"name":"lodash.get","reference":"4.4.2"}],
  ["../../../yarn/v6/npm-lodash-zip-4.2.0-ec6662e4896408ed4ab6c542a3990b72cc080020-integrity/node_modules/lodash.zip/", {"name":"lodash.zip","reference":"4.2.0"}],
  ["../../../yarn/v6/npm-import-modules-1.1.0-748db79c5cc42bb9701efab424f894e72600e9dc-integrity/node_modules/import-modules/", {"name":"import-modules","reference":"1.1.0"}],
  ["../../../yarn/v6/npm-lodash-camelcase-4.3.0-b28aa6288a2b9fc651035c7711f65ab6190331a6-integrity/node_modules/lodash.camelcase/", {"name":"lodash.camelcase","reference":"4.3.0"}],
  ["../../../yarn/v6/npm-lodash-defaultsdeep-4.6.1-512e9bd721d272d94e3d3a63653fa17516741ca6-integrity/node_modules/lodash.defaultsdeep/", {"name":"lodash.defaultsdeep","reference":"4.6.1"}],
  ["../../../yarn/v6/npm-lodash-kebabcase-4.1.1-8489b1cb0d29ff88195cceca448ff6d6cc295c36-integrity/node_modules/lodash.kebabcase/", {"name":"lodash.kebabcase","reference":"4.1.1"}],
  ["../../../yarn/v6/npm-lodash-snakecase-4.1.1-39d714a35357147837aefd64b5dcbb16becd8f8d-integrity/node_modules/lodash.snakecase/", {"name":"lodash.snakecase","reference":"4.1.1"}],
  ["../../../yarn/v6/npm-lodash-topairs-4.3.0-3b6deaa37d60fb116713c46c5f17ea190ec48d64-integrity/node_modules/lodash.topairs/", {"name":"lodash.topairs","reference":"4.3.0"}],
  ["../../../yarn/v6/npm-lodash-upperfirst-4.3.1-1365edf431480481ef0d1c68957a5ed99d49f7ce-integrity/node_modules/lodash.upperfirst/", {"name":"lodash.upperfirst","reference":"4.3.1"}],
  ["../../../yarn/v6/npm-reserved-words-0.1.2-00a0940f98cd501aeaaac316411d9adc52b31ab1-integrity/node_modules/reserved-words/", {"name":"reserved-words","reference":"0.1.2"}],
  ["../../../yarn/v6/npm-safe-regex-2.1.1-f7128f00d056e2fe5c11e81a1324dd974aadced2-integrity/node_modules/safe-regex/", {"name":"safe-regex","reference":"2.1.1"}],
  ["../../../yarn/v6/npm-regexp-tree-0.1.17-66d914a6ca21f95dd7660ed70a7dad47aeb2246a-integrity/node_modules/regexp-tree/", {"name":"regexp-tree","reference":"0.1.17"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 167 && relativeLocation[166] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 167)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 149 && relativeLocation[148] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 149)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 147 && relativeLocation[146] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 147)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 145 && relativeLocation[144] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 145)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 144 && relativeLocation[143] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 144)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 143 && relativeLocation[142] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 143)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 139 && relativeLocation[138] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 139)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 137 && relativeLocation[136] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 137)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 134 && relativeLocation[133] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 134)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 133 && relativeLocation[132] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 133)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 132 && relativeLocation[131] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 132)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 129 && relativeLocation[128] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 129)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 127 && relativeLocation[126] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 127)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 125 && relativeLocation[124] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 125)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 124 && relativeLocation[123] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 124)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 123 && relativeLocation[122] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 123)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 121 && relativeLocation[120] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 121)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 119 && relativeLocation[118] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 119)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 118 && relativeLocation[117] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 118)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 117 && relativeLocation[116] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 117)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 116 && relativeLocation[115] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 116)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 115 && relativeLocation[114] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 115)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 114 && relativeLocation[113] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 114)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 113 && relativeLocation[112] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 113)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 111 && relativeLocation[110] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 111)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 110 && relativeLocation[109] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 110)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 109 && relativeLocation[108] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 109)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 108 && relativeLocation[107] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 108)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 107 && relativeLocation[106] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 107)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 105 && relativeLocation[104] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 105)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 104 && relativeLocation[103] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 104)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 103 && relativeLocation[102] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 103)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 102 && relativeLocation[101] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 102)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 101 && relativeLocation[100] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 101)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 100 && relativeLocation[99] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 100)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 99 && relativeLocation[98] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 99)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 97 && relativeLocation[96] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 97)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          }
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName}
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName}
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName}
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates}
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)}
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {}
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath}
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          }
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths || []) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // make sure that basedir ends with a slash
          if (basedir.charAt(basedir.length - 1) !== '/') {
            basedir = path.join(basedir, '/');
          }
          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
