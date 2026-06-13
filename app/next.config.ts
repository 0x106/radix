import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Pin turbopack's root to app/ explicitly. The repo root also has a lockfile,
// so otherwise Next infers the repo root as the workspace root, which makes the
// dev server scan the whole repo (OOM) and shifts every module's identity path
// (breaking RSC's client manifest). The canonical Radix runtime/packaging now
// lives inside app/ (src/runtime), so no cross-boundary import is needed.
const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: appDir,
  },
  devIndicators: false
};

export default nextConfig;
