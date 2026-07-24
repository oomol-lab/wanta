import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, loadEnv } from "vite"
import electron from "vite-plugin-electron/simple"
import { branding, storageKey } from "./electron/branding.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// dev：让 vite-plugin-electron 启动 postinstall 下载到 .electron-dist 的那份
// Electron（带 dev 专用 Bundle ID / URL scheme = wanta-local）。仅当该副本存在
// 且调用方未显式覆盖时设置；缺失时回退到 electron 包默认解析。仅影响 vite 进程，
// 不影响后续独立运行的 electron-builder。
applyDevElectronOverride()

function applyDevElectronOverride(): void {
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    return
  }
  const distPath = path.join(dirname, ".electron-dist")
  const binary =
    process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron"
      : process.platform === "win32"
        ? "electron.exe"
        : "electron"
  if (fs.existsSync(path.join(distPath, binary))) {
    process.env.ELECTRON_OVERRIDE_DIST_PATH = distPath
  }
}
const appCommit = resolveAppCommit()
const appVersion = process.env.npm_package_version ?? "0.0.0"

function resolveAppCommit(): string {
  const fromEnv = process.env.WANTA_BUILD_COMMIT ?? process.env.GITHUB_SHA
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim()
  }

  try {
    return execSync("git rev-parse HEAD", { cwd: dirname, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return "unknown"
  }
}

// 解析构建期注入的 endpoint，缺省 oomol.com。优先级：
//   1) 显式 WANTA_ENDPOINT 环境变量（shell / CI），两种模式都生效；
//   2) 仅 dev/serve 读 .env(.local) 文件 —— build 刻意不读，避免本机 .env.local
//      （开发常指向 oomol.dev）污染对外分发的包；
//   3) 缺省 oomol.com。
// 故 CI/发布（无显式变量、build 不读文件）始终是 oomol.com，产物不含开发域名。
function resolveOoEndpoint(command: string, mode: string): string {
  const explicit = process.env.WANTA_ENDPOINT?.trim()
  if (explicit) {
    return explicit
  }
  if (command !== "build") {
    const fromFile = loadEnv(mode, dirname, "").WANTA_ENDPOINT?.trim()
    if (fromFile) {
      return fromFile
    }
  }
  return "oomol.com"
}

function resolvePackageAssetsBaseUrl(ooEndpoint: string): string {
  const explicit = process.env.WANTA_PACKAGE_ASSETS_BASE_URL?.trim()
  if (explicit) {
    return explicit
  }
  return `https://package-assets.${ooEndpoint}`
}

function shouldAutoStartElectron(command: string, mode: string): boolean {
  if (command === "build") {
    return true
  }

  const explicit = process.env.WANTA_ELECTRON_AUTO_START?.trim().toLowerCase()
  if (explicit) {
    return !["0", "false", "no", "off"].includes(explicit)
  }

  return mode !== "no-electron"
}

function resolveDevServerPort(): number {
  const explicit = process.env.WANTA_DEV_SERVER_PORT?.trim()
  if (!explicit) {
    return 5273
  }
  const parsed = Number(explicit)
  if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) {
    return parsed
  }
  throw new Error(`WANTA_DEV_SERVER_PORT must be an integer from 1024 to 65535, got "${explicit}"`)
}

function skipElectronStartup(): void {
  console.log("[wanta] Electron auto-start disabled for this Vite dev session.")
}

export default defineConfig(({ command, mode }) => {
  // 全局唯一 endpoint，常量替换注入（App 层不可见、不可切换，见 electron/domain.ts）。
  const ooEndpoint = resolveOoEndpoint(command, mode)
  const packageAssetsBaseUrl = resolvePackageAssetsBaseUrl(ooEndpoint)
  const autoStartElectron = shouldAutoStartElectron(command, mode)
  const devServerPort = resolveDevServerPort()
  const buildDefines = {
    __APP_COMMIT__: JSON.stringify(appCommit),
    __APP_VERSION__: JSON.stringify(appVersion),
    __OO_ENDPOINT__: JSON.stringify(ooEndpoint),
    __PACKAGE_ASSETS_BASE_URL__: JSON.stringify(packageAssetsBaseUrl),
  }

  return {
    define: buildDefines,
    resolve: {
      alias: {
        "@": path.resolve(dirname, "./src"),
      },
    },
    plugins: [
      // index.html 内联首帧主题脚本里的品牌值由 branding 单一来源注入（守 R1，避免硬编码品牌前缀）。
      {
        name: "wanta-inline-boot-theme-key",
        transformIndexHtml(html: string) {
          return html.replaceAll("%APP_NAME%", branding.appName).replaceAll("%WANTA_THEME_KEY%", storageKey("theme"))
        },
      },
      tailwindcss(),
      react(),
      electron({
        main: {
          entry: "electron/main.ts",
          ...(autoStartElectron ? {} : { onstart: skipElectronStartup }),
          vite: {
            define: buildDefines,
            build: {
              rollupOptions: {
                input: {
                  main: path.join(dirname, "electron/main.ts"),
                  "spreadsheet-preview-worker": path.join(dirname, "electron/chat/spreadsheet-preview-worker.ts"),
                },
                // @opencode-ai/sdk 依赖 cross-spawn（CJS require("child_process")）、electron-updater 走
                // CJS 动态 require，都不能打进 ESM 主进程包；外部化后由 Node 运行时解析（electron-builder
                // 随 dependencies 打包）。正则覆盖子路径导入（如 @opencode-ai/sdk/v2/client）——精确字符串
                // 匹配不会命中子路径，否则 v2 client 会被错误内联进主进程包。
                external: [/^@opencode-ai\/sdk(\/|$)/, "electron-updater"],
              },
            },
          },
        },
        preload: {
          input: path.join(dirname, "electron/preload.ts"),
          ...(autoStartElectron ? {} : { onstart: skipElectronStartup }),
          vite: {
            define: buildDefines,
            build: {
              rollupOptions: {
                output: {
                  entryFileNames: "preload.js",
                },
              },
            },
          },
        },
      }),
    ],
    server: {
      port: devServerPort,
      strictPort: true,
    },
    // 重型依赖（含 lazy chunk 里才用到的 streamdown / motion）显式预打包：server 启动时
    // 一次性 esbuild 预构建，避免渲染进程首次触达这些依赖时才即时优化、进而触发整页 reload 的卡顿。
    optimizeDeps: {
      include: [
        "@iconify-icons/simple-icons/cloudflare",
        "@iconify-icons/simple-icons/googlebigquery",
        "@iconify-icons/simple-icons/openai",
        "@iconify-icons/simple-icons/tencentqq",
        "@iconify-icons/simple-icons/wechat",
        "@iconify-icons/tabler/flame",
        "@iconify-icons/tabler/photo-star",
        "streamdown",
        "motion/react",
        "pdfjs-dist",
        "pdfjs-dist/web/pdf_viewer.mjs",
        "radix-ui",
        "use-stick-to-bottom",
      ],
    },
  }
})
