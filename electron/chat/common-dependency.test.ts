import assert from "node:assert/strict"
import { test } from "vitest"
import { isCommonNodeDependencyName, isCommonPythonDependencyName } from "./common-dependency.ts"

test("common Python dependencies cover agent document and data workflows", () => {
  for (const name of [
    "openpyxl",
    "pandas",
    "pypdf",
    "pymupdf",
    "pdfplumber",
    "reportlab",
    "python-docx",
    "python-pptx",
    "markitdown",
    "matplotlib",
    "scikit-learn",
    "pdf2image",
    "pytesseract",
  ]) {
    assert.equal(isCommonPythonDependencyName(name), true, name)
  }
  assert.equal(isCommonPythonDependencyName("fitz"), false)
  assert.equal(isCommonPythonDependencyName("unreviewed-agent-package"), false)
})

test("common Node dependencies cover agent document and transformation workflows", () => {
  for (const name of [
    "exceljs",
    "pdf-lib",
    "pdfjs-dist",
    "docx",
    "mammoth",
    "pptxgenjs",
    "sharp",
    "cheerio",
    "jsdom",
    "zod",
  ]) {
    assert.equal(isCommonNodeDependencyName(name), true, name)
  }
  for (const name of ["xlsx", "playwright", "puppeteer", "canvas", "unreviewed-agent-package"]) {
    assert.equal(isCommonNodeDependencyName(name), false, name)
  }
})
