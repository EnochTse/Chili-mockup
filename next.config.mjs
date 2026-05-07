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
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
