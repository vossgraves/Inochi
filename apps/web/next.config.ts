import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@inochi/core", "@inochi/database"],
  serverExternalPackages: ["postgres"],
};

export default config;
