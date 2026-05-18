const BASE = import.meta.env.VITE_API_BASE || "/api";

async function req(path, opts = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      signal: controller.signal,
      ...opts,
    });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const get  = (p, timeoutMs)    => req(p, {}, timeoutMs);
export const post = (p, b, timeoutMs) => req(p, { method: "POST", body: JSON.stringify(b) }, timeoutMs);
export const del  = (p, timeoutMs)    => req(p, { method: "DELETE" }, timeoutMs);