import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['react-plotly.js', 'plotly.js'],
  /* config options here */
};

export default nextConfig;
