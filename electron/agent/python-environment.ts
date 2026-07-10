/** Wanta 为单次任务创建的私有 Python 虚拟环境目录名。 */
export const WANTA_MANAGED_PYTHON_ENV_DIRNAME = ".wanta-python"

function pathSeparator(processDir: string): string {
  return processDir.includes("\\") && !processDir.includes("/") ? "\\" : "/"
}

function joinPath(processDir: string, ...parts: string[]): string {
  const separator = pathSeparator(processDir)
  return [processDir.replace(/[\\/]+$/u, ""), ...parts].join(separator)
}

export function managedPythonEnvironmentPath(processDir: string): string {
  return joinPath(processDir, WANTA_MANAGED_PYTHON_ENV_DIRNAME)
}

export function managedPythonExecutable(processDir: string, platform = process.platform): string {
  // shell 解析与 OpenCode permission resource 都使用正斜杠，避免 Windows 反斜杠被当作转义字符。
  const environmentDir = managedPythonEnvironmentPath(processDir).replace(/\\/g, "/")
  return platform === "win32" ? `${environmentDir}/Scripts/python.exe` : `${environmentDir}/bin/python`
}

export function isManagedPythonExecutable(executable: string): boolean {
  const normalized = executable.replace(/\\/g, "/").replace(/\/+$/u, "")
  return (
    normalized.endsWith(`/${WANTA_MANAGED_PYTHON_ENV_DIRNAME}/bin/python`) ||
    normalized.endsWith(`/${WANTA_MANAGED_PYTHON_ENV_DIRNAME}/Scripts/python.exe`)
  )
}
