import assert from "node:assert/strict"
import { test } from "vitest"
import {
  isManagedPythonExecutable,
  managedPythonEnvironmentPath,
  managedPythonExecutable,
  managedPythonExecutables,
  projectPythonExecutables,
} from "./python-environment.ts"

test("managed Python environment paths stay inside the task process directory", () => {
  const processDir = "/tmp/wanta-process/task-1"

  assert.equal(managedPythonEnvironmentPath(processDir), "/tmp/wanta-process/task-1/.wanta-python")
  assert.equal(managedPythonExecutable(processDir, "darwin"), "/tmp/wanta-process/task-1/.wanta-python/bin/python")
  assert.equal(
    managedPythonExecutable(processDir, "win32"),
    "/tmp/wanta-process/task-1/.wanta-python/Scripts/python.exe",
  )
  assert.equal(
    managedPythonExecutable("C:\\Users\\me\\AppData\\Local\\wanta\\process\\task-1", "win32"),
    "C:/Users/me/AppData/Local/wanta/process/task-1/.wanta-python/Scripts/python.exe",
  )
  assert.deepEqual(managedPythonExecutables(processDir, "linux"), [
    "/tmp/wanta-process/task-1/.wanta-python/bin/python",
    "/tmp/wanta-process/task-1/.wanta-python/bin/python3",
  ])
})

test("selected projects expose only their conventional virtual-environment interpreters", () => {
  assert.deepEqual(projectPythonExecutables("/Users/example/code/customer-project", "darwin"), [
    "/Users/example/code/customer-project/.venv/bin/python",
    "/Users/example/code/customer-project/.venv/bin/python3",
    "/Users/example/code/customer-project/venv/bin/python",
    "/Users/example/code/customer-project/venv/bin/python3",
  ])
  assert.deepEqual(projectPythonExecutables("C:\\code\\customer-project", "win32"), [
    "C:/code/customer-project/.venv/Scripts/python.exe",
    "C:/code/customer-project/venv/Scripts/python.exe",
  ])
})

test("managed Python executable recognition requires the dedicated virtual environment", () => {
  assert.equal(isManagedPythonExecutable("/tmp/task/.wanta-python/bin/python"), true)
  assert.equal(isManagedPythonExecutable("/tmp/task/.wanta-python/bin/python3"), true)
  assert.equal(isManagedPythonExecutable("C:\\tmp\\task\\.wanta-python\\Scripts\\python.exe"), true)
  assert.equal(isManagedPythonExecutable("/usr/bin/python3"), false)
  assert.equal(isManagedPythonExecutable("/tmp/task/.wanta-python/bin/pip"), false)
})
