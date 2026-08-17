# Ready-to-upload submission document

`submission.docx` is the full write-up with all six screenshots embedded. It is
built from [`../SUBMISSION.md`](../SUBMISSION.md) by
[`../scripts/build-doc.mjs`](../scripts/build-doc.mjs) and converted with
LibreOffice.

## Turning it into a Google Doc

1. Go to [drive.google.com](https://drive.google.com)
2. Drag `submission.docx` into the window
3. Right-click the uploaded file → **Open with** → **Google Docs**
4. **Share** → General access → **Anyone with the link** → Viewer
5. Copy that link into the Superteam Earn submission

Step 3 creates a native Google Doc; formatting, tables and all six images carry
across. The original `.docx` stays in Drive alongside it and can be deleted.

## Files

| | |
|---|---|
| `submission.docx` | Upload this one. 373 KB, 12 pages, 6 images embedded as PNGs. |
| `submission.pdf` | Same content as PDF, for a quick read or as a fallback attachment. |
| `submission.html` | Source for the conversion. Google Docs can import this too (**File → Open → Upload**), but the `.docx` preserves image sizing more reliably. |

## Rebuilding

```bash
node scripts/build-doc.mjs
cd submission
soffice --headless --convert-to docx:"MS Word 2007 XML" submission.html
soffice --headless --convert-to pdf submission.docx
```

Edit `SUBMISSION.md` and re-run — never edit the `.docx` directly, it is build
output.
