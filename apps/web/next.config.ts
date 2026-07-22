import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@inochi/core", "@inochi/database"],
  serverExternalPackages: ["@napi-rs/canvas", "postgres"],
};

export default config;
