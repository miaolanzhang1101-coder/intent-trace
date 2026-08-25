// Real code execution. The workspace files run for real, in a Web Worker built
// from a Blob so there is no bundler and no network — an infinite loop in user
// code is contained and killed by a watchdog rather than freezing the page.
//
// The worker implements just enough of CommonJS (require between the project's
// own files) and a Jest-style test/expect harness to run a small suite.

export const WORKER_SRC = `
self.onmessage = function (e) {
  var files = e.data.files, entry = e.data.entry;
  var logs = [];
  function fmt(v) {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.message;
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  function mkConsole() {
    function push(level) { return function () {
      var a = Array.prototype.slice.call(arguments);
      logs.push({ level: level, text: a.map(fmt).join(' ') });
    }; }
    return { log: push('log'), info: push('info'), warn: push('warn'), error: push('error'), debug: push('log') };
  }
  var cons = mkConsole();

  function resolveKey(from, req) {
    var name = req.replace(/^\\.\\//, '');
    if (files[name]) return name;
    if (files[name + '.js']) return name + '.js';
    if (files[req]) return req;
    return null;
  }

  var cache = {};
  function requireFrom(fromKey) {
    return function (req) {
      var key = resolveKey(fromKey, req);
      if (!key) throw new Error("Cannot find module '" + req + "'");
      if (cache[key]) return cache[key].exports;
      var module = { exports: {} };
      cache[key] = module;
      var fn = new Function('module', 'exports', 'require', 'console', files[key]);
      fn(module, module.exports, requireFrom(key), cons);
      return module.exports;
    };
  }

  // Jest-style harness
  var results = [];
  function test(name, fn) {
    var r = { name: name, pass: true, error: null };
    var t0 = Date.now();
    try { fn(); } catch (err) { r.pass = false; r.error = (err && err.message) || String(err); }
    r.ms = Date.now() - t0;
    results.push(r);
  }
  function expect(received) {
    return {
      toBe: function (exp) { if (received !== exp) throw new Error('expected ' + fmt(exp) + ' but got ' + fmt(received)); },
      toEqual: function (exp) { if (JSON.stringify(received) !== JSON.stringify(exp)) throw new Error('expected ' + fmt(exp) + ' but got ' + fmt(received)); },
      toBeCloseTo: function (exp, p) { var d = Math.pow(10, -(p == null ? 2 : p)) / 2; if (Math.abs(received - exp) > d) throw new Error('expected ~' + fmt(exp) + ' but got ' + fmt(received)); },
      toBeGreaterThan: function (n) { if (!(received > n)) throw new Error('expected ' + fmt(received) + ' > ' + fmt(n)); },
      toBeTruthy: function () { if (!received) throw new Error('expected a truthy value but got ' + fmt(received)); },
      toThrow: function (msg) {
        var threw = false, err;
        try { received(); } catch (x) { threw = true; err = x; }
        if (!threw) throw new Error('expected the function to throw');
        if (msg && String(err && err.message).indexOf(msg) === -1)
          throw new Error('expected a thrown error containing "' + msg + '" but got "' + (err && err.message) + '"');
      },
    };
  }

  try {
    var entryFn = new Function('require', 'console', 'test', 'expect', files[entry]);
    entryFn(requireFrom(entry), cons, test, expect);
    self.postMessage({ ok: true, results: results, logs: logs });
  } catch (err) {
    self.postMessage({ ok: false, results: results, logs: logs, error: (err && err.message) || String(err) });
  }
};
`

let blobUrl = null
function workerUrl() {
  if (!blobUrl) {
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' })
    blobUrl = URL.createObjectURL(blob)
  }
  return blobUrl
}

/**
 * Run the workspace for real.
 * @param {Object} files  map of filename -> source
 * @param {string} entry  the test file to execute
 * @param {number} timeoutMs watchdog for runaway code
 * @returns {Promise<{ok, results, logs, error?, durationMs, timedOut?}>}
 */
export function runWorkspace(files, entry, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const worker = new Worker(workerUrl())
    const started = performance.now()
    const timer = setTimeout(() => {
      worker.terminate()
      resolve({
        ok: false,
        results: [],
        logs: [],
        error: `Execution exceeded ${timeoutMs} ms and was stopped (possible infinite loop).`,
        durationMs: Math.round(performance.now() - started),
        timedOut: true,
      })
    }, timeoutMs)

    worker.onmessage = (e) => {
      clearTimeout(timer)
      worker.terminate()
      resolve({ ...e.data, durationMs: Math.round(performance.now() - started) })
    }
    worker.onerror = (err) => {
      clearTimeout(timer)
      worker.terminate()
      resolve({
        ok: false,
        results: [],
        logs: [],
        error: err.message || 'Worker error',
        durationMs: Math.round(performance.now() - started),
      })
    }
    worker.postMessage({ files, entry })
  })
}
