import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv } from "vite"
import { defineConfig } from "vitest/config"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// 与 vite.config.ts 同机制：经 loadEnv 读取 .env(.local) 的 WANTA_ENDPOINT 并常量替换到
// electron/domain.ts 的 __OO_ENDPOINT__，缺省 oomol.com。无需任何运行时注入。
// 测试断言由 ooEndpoint 派生（与具体取值无关），故 CI（缺省 oomol.com）与本地
// （.env.local 覆盖）都确定性通过。测试文件与本配置都不进打包产物。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const ooEndpoint = env.WANTA_ENDPOINT?.trim() || "oomol.com"
  const packageAssetsBaseUrl = env.WANTA_PACKAGE_ASSETS_BASE_URL?.trim() || `https://package-assets.${ooEndpoint}`
  return {
    resolve: {
      alias: {
        "@": path.resolve(dirname, "src"),
      },
    },
    define: {
      __OO_ENDPOINT__: JSON.stringify(ooEndpoint),
      __PACKAGE_ASSETS_BASE_URL__: JSON.stringify(packageAssetsBaseUrl),
    },
    test: {
      include: ["electron/**/*.test.ts", "src/**/*.test.ts", "scripts/**/*.test.ts"],
      environment: "node",
    },
  }
})
