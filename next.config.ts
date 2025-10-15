import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // ✅ 忽略 ESLint 报错
  },
  // 如果 TypeScript 报类型错误，也可以打开下面这两行
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
};

export default nextConfig;

