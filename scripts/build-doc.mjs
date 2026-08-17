/**
 * Build a Google-Docs-ready document from SUBMISSION.md.
 *
 *   node scripts/build-doc.mjs
 *
 * Produces submission/submission.html with the six screenshots embedded as data
 * URIs. LibreOffice then converts that to .docx, which Google Drive imports
 * as a native Google Doc with formatting and images intact.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { marked } from "marked";

const ROOT = new URL("..", import.meta.url);
const md = await readFile(new URL("SUBMISSION.md", ROOT), "utf8");

// Where each screenshot belongs, keyed by the numbered line it follows in the
// Screenshots section.
const SHOTS = [
  ["1-register-and-maps.png", "Registering the Rust TEE contract on testnet"],
  ["2-end-to-end-invoke.png", "The full flow: issue, reuse, verify, reject tampered"],
  ["3-placeholder-resolution-proof.png", "Proof the host resolves PII placeholders"],
  ["4-tenant-me-not-a-function.png", "BUG-10 reproduced: tenant.me is not a function"],
  ["5-bug01-does-not-compile.png", "BUG-01 reproduced: the documented Rust snippet fails to compile"],
  ["6-test-suite.png", "38 tests passing"],
];

/** Usable text width on A4 at 1.5cm margins, in px at 96dpi. */
const MAX_W = 660;

async function embed(file) {
  const buf = await readFile(new URL(`screenshots/${file}`, ROOT));
  // PNG IHDR: width at byte 16, height at byte 20, both big-endian uint32.
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const scale = Math.min(1, MAX_W / w);
  return {
    uri: `data:image/png;base64,${buf.toString("base64")}`,
    w: Math.round(w * scale),
    h: Math.round(h * scale),
  };
}

// Build the figure block that replaces the placeholder list in the doc.
// LibreOffice honours explicit width/height attributes but not max-width, so
// the dimensions are computed here rather than left to CSS.
let figures = "";
for (const [file, caption] of SHOTS) {
  const n = file.split("-")[0];
  const { uri, w, h } = await embed(file);
  figures +=
    `<p class="shot-cap"><b>Screenshot ${n} — ${caption}</b></p>\n` +
    `<p><img src="${uri}" width="${w}" height="${h}" alt="${caption}"/></p>\n`;
}

let body = marked.parse(md, { mangle: false, headerIds: false });

// Drop the placeholder numbered list under "## Screenshots" and put the real
// images there instead.
body = body.replace(
  /(<h2>Screenshots<\/h2>[\s\S]*?<\/p>)\s*<ol>[\s\S]*?<\/ol>/,
  `$1\n${figures}`,
);

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Terminal 3 ADK — Bounty Submission</title>
<style>
  @page { size: A4; margin: 1.5cm; }
  body { font-family: Georgia, serif; font-size: 11pt; line-height: 1.45; color: #111; }
  h1 { font-size: 20pt; margin-top: 18pt; }
  h2 { font-size: 15pt; margin-top: 20pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; }
  h3 { font-size: 12.5pt; margin-top: 14pt; }
  code, pre { font-family: "DejaVu Sans Mono", Consolas, monospace; font-size: 9pt; }
  pre { background: #f4f4f4; border: 1px solid #ddd; padding: 8pt; white-space: pre-wrap; }
  code { background: #f4f4f4; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; }
  th, td { border: 1px solid #bbb; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #eee; }
  blockquote { border-left: 3px solid #bbb; margin-left: 0; padding-left: 10pt; color: #444; font-style: italic; }
  img { border: 1px solid #999; }
  .shot-cap { margin-bottom: 2pt; font-family: Georgia, serif; }
</style></head><body>
${body}
</body></html>`;

await mkdir(new URL("submission/", ROOT), { recursive: true });
await writeFile(new URL("submission/submission.html", ROOT), html);
console.log(`wrote submission/submission.html (${(html.length / 1024 / 1024).toFixed(2)} MB, ${SHOTS.length} images embedded)`);
