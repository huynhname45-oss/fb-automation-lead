// Shim to enable Playwright compatibility inside pkg Node 18 binary
const Module = require('module');

// 1. Polyfill Node version check for Playwright
if (parseInt(process.versions.node.split('.')[0], 10) < 20) {
  try {
    Object.defineProperty(process.versions, 'node', { value: '20.0.0', configurable: true });
  } catch (e) {}
}

// 2. Polyfill node:inspector for pkg binary (pkg compiles Node without inspector)
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'inspector' || id === 'node:inspector') {
    return {
      url: () => undefined,
      open: () => {},
      close: () => {},
      waitForDebugger: () => {},
      console: console,
      Session: class {}
    };
  }
  return origRequire.apply(this, arguments);
};

// 3. Polyfill globalThis.crypto for pkce-challenge and Playwright inside pkg
try {
  const nodeCrypto = require('crypto');
  if (!globalThis.crypto) {
    globalThis.crypto = nodeCrypto.webcrypto || nodeCrypto;
  } else if (!globalThis.crypto.webcrypto && nodeCrypto.webcrypto) {
    globalThis.crypto.webcrypto = nodeCrypto.webcrypto;
  }
} catch (e) {}

