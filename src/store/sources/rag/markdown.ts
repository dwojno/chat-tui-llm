import { extname } from "node:path";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

const CODE_LANGS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sh": "bash",
  ".bash": "bash",
  ".sql": "sql",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".css": "css",
  ".scss": "scss",
};

export async function toMarkdown(path: string, bytes: Buffer): Promise<string> {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".md":
    case ".markdown":
      return decode(bytes);
    case ".html":
    case ".htm":
      return turndown.turndown(decode(bytes));
    case ".docx": {
      const { value } = await mammoth.convertToHtml({ buffer: bytes });
      return turndown.turndown(value);
    }
    case ".pdf":
      return pdfToMarkdown(bytes);
    case ".xlsx":
    case ".xls":
      return workbookToMarkdown(bytes, { perSheetHeadings: true });
    case ".csv":
      return workbookToMarkdown(bytes, { perSheetHeadings: false });
    default:
      return textToMarkdown(ext, bytes);
  }
}

function decode(bytes: Buffer): string {
  return bytes.toString("utf8").replace(/\r\n/g, "\n");
}

function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 8000);
  return sample.includes(0);
}

function textToMarkdown(ext: string, bytes: Buffer): string {
  if (looksBinary(bytes)) {
    throw new Error(`Unsupported binary file type: ${ext || "(no extension)"}`);
  }
  const content = decode(bytes);
  const lang = CODE_LANGS[ext];
  return lang ? `\`\`\`${lang}\n${content}\n\`\`\`` : content;
}

async function pdfToMarkdown(bytes: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}

interface WorkbookOptions {
  perSheetHeadings: boolean;
}

function workbookToMarkdown(bytes: Buffer, opts: WorkbookOptions): string {
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const sections: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    if (!rows.length) continue;
    const table = toMarkdownTable(rows.map((row) => row.map(cellToString)));
    sections.push(opts.perSheetHeadings ? `## ${name}\n\n${table}` : table);
  }
  return sections.join("\n\n");
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function toMarkdownTable(rows: string[][]): string {
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]): string[] => Array.from({ length: width }, (_, i) => row[i] ?? "");
  const [header, ...body] = rows;
  const lines = [
    `| ${pad(header ?? []).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`),
  ];
  return lines.join("\n");
}
