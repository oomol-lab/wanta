// postinstall：dev 环境下载官方 Electron 到 .electron-dist，并在 macOS 改写
// Info.plist（Bundle ID / 名称 / dev URL scheme），让本地 dev 版能独立接住
// deep-link 回调（dev scheme = lumo-local）。
//
// 说明：dev 实际启动用的是 electron 包自身 postinstall 下载到
// node_modules/electron/dist 的副本；.electron-dist 这份**专供 macOS dev
// deep-link scheme 注册**（com.oomol.lumo-local）。因此本脚本对 stage-0 的
// `dev` 启动不是必需，全程 best-effort：任何失败都只告警、不阻断 npm install。
//
// extract 用 @electron-internal/extract-zip（本项目约定不直接依赖 extract-zip）。

import type { PlistValue } from "plist"

import extract from "@electron-internal/extract-zip"
import { downloadArtifact } from "@electron/get"
import electronPackageJson from "electron/package.json" with { type: "json" }
import { execFile } from "node:child_process"
import { access, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { build as buildPlist, parse as parsePlist } from "plist"
import { branding } from "../electron/branding.ts"

type ElectronInfoPlist = Record<string, PlistValue>

const dirname = path.dirname(fileURLToPath(import.meta.url))
const electronDistPath = path.join(dirname, "..", ".electron-dist")
const electronVersion = electronPackageJson.version
const execFileAsync = promisify(execFile)
const macLaunchServicesRegister =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

// 品牌标识来自 electron/branding.ts（R1 单一来源）。
const macLocalBundleIdentifier = branding.devBundleId
const macLocalProtocolScheme = branding.devProtocolScheme
const macLocalDisplayName = `${branding.appName} Local`

await main()

async function main(): Promise<void> {
  try {
    if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === "1") {
      if (await electronDistExists()) {
        await writeElectronPackagePath()
        if (process.platform === "darwin") {
          await modifyPlist()
        }
      }
      console.log("ELECTRON_SKIP_BINARY_DOWNLOAD=1, skip downloading Electron binary.")
      return
    }

    if (await isElectronDistUpToDate()) {
      console.log(`[lumo] .electron-dist already at v${electronVersion}, skip download.`)
      await writeElectronPackagePath()
      if (process.platform === "darwin") {
        await modifyPlist()
      }
      return
    }

    await rm(electronDistPath, { recursive: true, force: true })

    const electronZIP = await downloadArtifact({
      version: electronVersion,
      artifactName: "electron",
      platform: process.platform,
      arch: process.arch,
    })

    await extract(electronZIP, { dir: electronDistPath })
    await writeElectronPackagePath()

    if (process.platform === "darwin") {
      await modifyPlist()
    }
  } catch (error) {
    console.warn("[lumo] download-electron postinstall failed (non-fatal):", error)
  }
}

async function writeElectronPackagePath(): Promise<void> {
  const pathTxtPath = path.join(dirname, "..", "node_modules", "electron", "path.txt")
  await writeFile(pathTxtPath, getPlatformExecutablePath(), "utf-8")
}

async function electronDistExists(): Promise<boolean> {
  try {
    await access(path.join(electronDistPath, getPlatformExecutablePath()))
    return true
  } catch {
    return false
  }
}

async function isElectronDistUpToDate(): Promise<boolean> {
  try {
    if (!(await electronDistExists())) {
      return false
    }
    const versionContent = await readFile(path.join(electronDistPath, "version"), "utf-8")
    return versionContent.trim().replace(/^v/, "") === electronVersion
  } catch {
    return false
  }
}

function getPlatformExecutablePath(): string {
  switch (process.platform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron"
    case "win32":
      return "electron.exe"
    case "freebsd":
    case "linux":
    case "openbsd":
      return "electron"
    default:
      throw new Error(`Electron builds are not available on platform: ${process.platform}`)
  }
}

async function modifyPlist(): Promise<void> {
  const plistPath = path.join(electronDistPath, "Electron.app", "Contents", "Info.plist")
  const plistContent = await readFile(plistPath, "utf-8")
  const infoPlist = parsePlist(plistContent) as ElectronInfoPlist

  infoPlist["CFBundleDisplayName"] = macLocalDisplayName
  infoPlist["CFBundleIdentifier"] = macLocalBundleIdentifier
  infoPlist["CFBundleName"] = macLocalDisplayName
  infoPlist["CFBundleURLTypes"] = [
    {
      CFBundleTypeRole: "Viewer",
      CFBundleURLName: macLocalDisplayName,
      CFBundleURLSchemes: [macLocalProtocolScheme],
    },
  ]

  await writeFile(plistPath, buildPlist(infoPlist), "utf-8")

  try {
    await registerMacAppBundle()
  } catch (error) {
    console.warn("[lumo] mac URL scheme registration failed (non-fatal):", error)
  }
}

async function registerMacAppBundle(): Promise<void> {
  const appPath = path.join(electronDistPath, "Electron.app")

  await execFileAsync(macLaunchServicesRegister, ["-f", appPath])
  await execFileAsync("osascript", [
    "-l",
    "JavaScript",
    "-e",
    [
      'ObjC.import("CoreServices")',
      `const status = $.LSSetDefaultHandlerForURLScheme($(${JSON.stringify(macLocalProtocolScheme)}), $(${JSON.stringify(macLocalBundleIdentifier)}))`,
      "if (status !== 0) throw new Error(`LSSetDefaultHandlerForURLScheme failed: ${status}`)",
    ].join("; "),
  ])
}
