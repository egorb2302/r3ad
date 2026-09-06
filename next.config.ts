import type { NextConfig } from "next";

/*
 * Канонический адрес для ссылок `/s/:id` (§11.1). Если не задан руками, на
 * Vercel берётся домен продакшена — его платформа подставляет сама, и
 * заводить ради него переменную в панели незачем.
 */
const origin =
  process.env.NEXT_PUBLIC_APP_ORIGIN ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined);

const nextConfig: NextConfig = {
  env: origin ? { NEXT_PUBLIC_APP_ORIGIN: origin } : {},
};

export default nextConfig;
