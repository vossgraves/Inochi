import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@inochi/core", "@inochi/database"],
  serverExternalPackages: ["postgres"],
};

export default config;
