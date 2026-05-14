/* ─── PHYSIQ ENGINE — Network Utilities ───────────────────────────────────── */

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function fetchWithTimeout(url, timeoutMs, options) {
  timeoutMs = timeoutMs || 10000;
  options = options || {};

  return new Promise(function(resolve, reject) {
    if (isOffline()) {
      return reject(new Error("OFFLINE"));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(function() {
      controller.abort();
    }, timeoutMs);

    options.signal = controller.signal;

    fetch(url, options)
      .then(function(res) {
        clearTimeout(timeoutId);
        resolve(res);
      })
      .catch(function(err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          reject(new Error("TIMEOUT"));
        } else {
          reject(err);
        }
      });
  });
}
