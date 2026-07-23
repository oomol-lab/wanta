# Common agent dependency policy

Wanta Default Access automatically approves a reviewed set of common Python and Node.js
dependencies when an agent uses them inside a bounded task or project environment. The goal is to
remove repetitive confirmation prompts for ordinary spreadsheet, PDF, document, image, data, and
web-processing work without turning package installation into an unrestricted shell exception.

The executable source of truth is
[`electron/chat/common-dependency.ts`](../electron/chat/common-dependency.ts). This document explains
the product boundary and review rationale.

## Automatic approval boundary

Python installs qualify only when all of these conditions hold:

- The executable is the exact interpreter in the active turn's private `.wanta-python` environment.
- The command uses `python -m pip install` with direct package requirements.
- Every direct package is in the curated Python list.
- Ordinary extras, version constraints, and safe convenience flags are accepted. Wanta does not add
  or pin a version.
- Requirements files, editable installs, system/user Python, alternative indexes, URLs, Git sources,
  local paths, `--user`, `--break-system-packages`, and unknown flags do not qualify.

Node.js installs qualify only when all of these conditions hold:

- The command uses npm, pnpm, yarn, or bun and explicitly targets either the active turn process
  directory or the user-selected project.
- The operation directly installs one or more named packages, and every direct package is curated.
- Ordinary versions and safe save/lockfile flags are accepted. Wanta does not add or pin a version.
- No-argument installs, mixed curated-and-unlisted requests, global installs, package runners,
  alternative registries, user config, Git/URL/local sources, aliases, and unknown flags do not
  qualify.

An auto-approved package can still rely on an external binary. Wanta approves only the bounded
package-manager command; a later Homebrew, apt, Java, browser download, or other system-level
installation remains independently protected.

## Curated Python packages

| Workflow                       | Direct package names                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spreadsheets and tables        | `openpyxl`, `pandas`, `polars`, `pyarrow`, `pyxlsb`, `xlrd`, `xlsxwriter`, `odfpy`, `duckdb`, `tabulate`                                                                           |
| PDF creation and extraction    | `pypdf`, `pypdf2`, `pymupdf`, `pypdfium2`, `pdfplumber`, `reportlab`, `fpdf2`, `camelot-py`, `pdf2image`, `tabula-py`                                                              |
| Word, PowerPoint, conversion   | `python-docx`, `python-pptx`, `markitdown`, `pypandoc`                                                                                                                             |
| Images, charts, and OCR        | `pillow`, `imageio`, `opencv-python`, `matplotlib`, `seaborn`, `plotly`, `kaleido`, `pytesseract`                                                                                  |
| Data science and math          | `numpy`, `scipy`, `scikit-image`, `scikit-learn`, `statsmodels`, `sympy`, `networkx`                                                                                               |
| Web, text, and structured data | `requests`, `httpx`, `beautifulsoup4`, `lxml`, `html5lib`, `markdown`, `jinja2`, `jsonschema`, `pyyaml`, `orjson`, `chardet`, `charset-normalizer`, `rapidfuzz`, `python-dateutil` |
| Agent utility                  | `rich`, `tenacity`, `tqdm`, `typer`                                                                                                                                                |

`fitz` is deliberately excluded: the PyPI project with that name is unrelated to PyMuPDF. Agents
should install `pymupdf` and import `fitz` from that distribution when required.

## Curated Node.js packages

| Workflow                   | Direct package names                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Spreadsheets and documents | `exceljs`, `docx`, `mammoth`, `pptxgenjs`                                                                     |
| PDF work                   | `pdf-lib`, `pdf-parse`, `pdfjs-dist`, `pdfkit`, `pdfmake`                                                     |
| Images                     | `sharp`                                                                                                       |
| HTML and Markdown          | `cheerio`, `jsdom`, `html-to-text`, `sanitize-html`, `marked`, `markdown-it`, `turndown`, `ejs`, `handlebars` |
| CSV, XML, YAML, and JSON   | `csv-parse`, `csv-stringify`, `papaparse`, `fast-xml-parser`, `xml2js`, `yaml`, `json5`, `ajv`, `zod`         |
| Archives and files         | `adm-zip`, `archiver`, `jszip`, `fast-glob`, `glob`, `minimatch`                                              |
| HTTP and execution         | `axios`, `undici`, `execa`                                                                                    |
| General utilities          | `lodash`, `date-fns`, `dayjs`, `decimal.js`, `mathjs`, `commander`, `yargs`, `p-limit`, `p-map`               |

The npm-registry package `xlsx` is deliberately excluded because SheetJS says the public npm copy is
outdated and recommends another distribution channel. `playwright`, `puppeteer`, and `canvas` are
also excluded from the fast path because they can trigger large browser downloads or native system
dependencies.

## Research basis

The list emphasizes packages repeatedly used by first-party agent document skills and established
document-processing projects:

- Anthropic's spreadsheet skill uses pandas and openpyxl, while its PDF and presentation skills use
  packages such as pypdf, pdfplumber, reportlab, pdf-lib, and pptxgenjs:
  [XLSX](https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md),
  [PDF](https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md), and
  [PPTX](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md).
- OpenAI's curated document skills use reportlab, pdfplumber, pypdf, python-docx, and pdf2image:
  [PDF](https://github.com/openai/skills/blob/main/skills/.curated/pdf/SKILL.md) and
  [DOC](https://github.com/openai/skills/blob/main/skills/.curated/doc/SKILL.md).
- Microsoft's [MarkItDown](https://github.com/microsoft/markitdown/blob/main/README.md) covers PDF,
  Word, PowerPoint, Excel, HTML, CSV, XML, ZIP, and related agent-ingestion workflows.
- The exclusions and external-runtime caveats follow the upstream
  [SheetJS installation guidance](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/),
  [PyMuPDF installation guidance](https://pymupdf.readthedocs.io/en/latest/installation.html),
  [pdf2image metadata](https://pypi.org/project/pdf2image/),
  [pytesseract metadata](https://pypi.org/project/pytesseract/),
  [Puppeteer installation guide](https://pptr.dev/guides/installation), and
  [node-canvas documentation](https://github.com/Automattic/node-canvas).

## Maintenance

Changing this policy requires synchronized updates to the curated sets, parser/policy tests, system
prompt, process-directory instructions, and permission documentation. A new package should be
verified against its official registry identity and upstream project, evaluated for install scripts,
native binaries, large downloads, source overrides, and confusing package names, and added only when
its ordinary agent use justifies silent installation in the bounded environment.
