import { post } from "./client.js";

// Agent calls chain Genie polling (≤60s) + LLM inference (≤45s) — use a generous timeout.
export const askAgent = (question, context = "") =>
  post("/agent/ask", { question, context }, 120_000);
export const askGenie = (question) =>
  post("/genie/ask", { question }, 90_000);