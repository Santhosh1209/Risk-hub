import { get } from "./client.js";
import { getCached, setCached } from "./cache.js";

export const FORECAST_KEYS = {
  history:   "forecast/history",
  predict:   (h) => `forecast/predict-${h}`,
  merchants: "forecast/merchants",
  cityRisk:  "forecast/city-risk",
  suspects:  "forecast/suspects",
};

function cached(key, fetcher) {
  const hit = getCached(key);
  if (hit !== null) return Promise.resolve(hit);
  return fetcher().then(v => setCached(key, v));
}

const T = 120_000;

export const fetchHistory          = () => cached(FORECAST_KEYS.history,         () => get("/forecast/history", T));
export const fetchPredictions      = (horizon = 7) => cached(FORECAST_KEYS.predict(horizon), () => get(`/forecast/predict?horizon=${horizon}`, T));
export const fetchMerchants        = () => cached(FORECAST_KEYS.merchants,       () => get("/forecast/merchants", T));
export const fetchCityRisk         = () => cached(FORECAST_KEYS.cityRisk,        () => get("/forecast/city-risk", T));
export const fetchSuspectCustomers = () => cached(FORECAST_KEYS.suspects,        () => get("/forecast/suspect-customers", T));
