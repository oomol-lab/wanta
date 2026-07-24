/** Private Python virtual environment created by Wanta for one task. */
export const WANTA_MANAGED_PYTHON_ENV_DIRNAME = ".wanta-python"
const PROJECT_PYTHON_ENV_DIRNAMES = [".venv", "venv"] as const

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

function environmentPythonExecutables(environmentDir: string, platform = process.platform): string[] {
  const normalized = environmentDir.replace(/\\/g, "/").replace(/\/+$/u, "")
  return platform === "win32"
    ? [`${normalized}/Scripts/python.exe`]
    : [`${normalized}/bin/python`, `${normalized}/bin/python3`]
}

export function managedPythonExecutables(processDir: string, platform = process.platform): string[] {
  return environmentPythonExecutables(managedPythonEnvironmentPath(processDir), platform)
}

export function managedPythonExecutable(processDir: string, platform = process.platform): string {
  // Shell parsing and OpenCode permission resources both use forward slashes so Windows
  // backslashes are not interpreted as escape characters.
  return managedPythonExecutables(processDir, platform)[0] ?? ""
}

export function projectPythonExecutables(projectDir: string, platform = process.platform): string[] {
  return PROJECT_PYTHON_ENV_DIRNAMES.flatMap((environmentName) =>
    environmentPythonExecutables(joinPath(projectDir, environmentName), platform),
  )
}

export function isManagedPythonExecutable(executable: string): boolean {
  const normalized = executable.replace(/\\/g, "/").replace(/\/+$/u, "")
  return (
    normalized.endsWith(`/${WANTA_MANAGED_PYTHON_ENV_DIRNAME}/bin/python`) ||
    normalized.endsWith(`/${WANTA_MANAGED_PYTHON_ENV_DIRNAME}/bin/python3`) ||
    normalized.endsWith(`/${WANTA_MANAGED_PYTHON_ENV_DIRNAME}/Scripts/python.exe`)
  )
}
