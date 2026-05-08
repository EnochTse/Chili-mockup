import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  ...(process.env.NEXT_OUTPUT_EXPORT === "true"
    ? {
        output: "export",
        images: {
          unoptimized: true
        }
      }
    : {}),
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["@"] = path.resolve(process.cwd(), "src");
    return config;
  },
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
