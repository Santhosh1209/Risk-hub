const store = new Map();

export const getCached    = (key)       => store.has(key) ? store.get(key) : null;
export const setCached    = (key, val)  => { store.set(key, val); return val; };
export const invalidate   = (...keys)   => keys.forEach(k => store.delete(k));
export const invalidateAll = ()         => store.clear();
