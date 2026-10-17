// Serve the last history immediately while one refresh runs. Live allowances
// use a separate channel and always retain their own observation timestamps.
export function createSnapshotReader({ load, ttlMs = 4000, clock = Date.now }) {
  const entries = new Map();
  function start(key, entry) {
    const operation = Promise.resolve().then(() => load(key)).then(value => {
      if (entries.get(key) === entry) { entry.value = value; entry.at = clock(); entry.error = false; }
      return value;
    }, error => {
      if (entries.get(key) === entry) { entry.at = clock(); entry.error = true; }
      throw error;
    }).finally(() => { entry.inFlight = null; });
    entry.inFlight = operation;
    return operation;
  }
  const read = async key => {
    let entry = entries.get(key);
    if (!entry) { entry = { at: 0, value: null, inFlight: null }; entries.set(key, entry); }
    if (!entry.value) return entry.inFlight || start(key, entry);
    if (clock() - entry.at >= ttlMs && !entry.inFlight) void start(key, entry).catch(() => {});
    return { ...entry.value, refreshing: Boolean(entry.inFlight), ...(entry.error ? { historyStale: true } : {}) };
  };
  read.clear = () => entries.clear();
  return read;
}
