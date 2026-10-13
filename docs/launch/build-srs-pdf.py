"""Build the PDFs of SRS-Fazal.md, SRS-Uzair.md and the review reply from their Markdown.
Needs: pip install markdown, and Google Chrome (used headless to print the HTML to PDF).
Run: python3 docs/launch/build-srs-pdf.py
"""
import os, subprocess, tempfile, sys
import markdown

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CSS = """
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 10.5pt;
       line-height: 1.45; color: #0A0D13; }
h1 { font-size: 24pt; color: #0A0D13; margin: 0 0 6pt; }
h1 + p { color: #6D7486; }
h2 { font-size: 16pt; color: #249E87; margin: 22pt 0 8pt; page-break-before: always; border-bottom: 2px solid #249E87; padding-bottom: 4pt; }
h2:first-of-type { page-break-before: auto; }
h3 { font-size: 12.5pt; color: #0A0D13; margin: 16pt 0 6pt; page-break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt 18pt; padding: 0; }
li { margin: 0 0 3pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.3pt; page-break-inside: auto; }
th { background: #249E87; color: #fff; text-align: left; padding: 5pt 6pt; font-weight: 600; }
td { border-bottom: 1px solid #E7E9ED; padding: 4.5pt 6pt; vertical-align: top; }
tr { page-break-inside: avoid; }
tr:nth-child(even) td { background: #F6F7F9; }
code { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 8.8pt; background: #F6F7F9; padding: 0 3pt; border-radius: 3px; }
pre { background: #F6F7F9; border: 1px solid #E7E9ED; border-radius: 4px; padding: 8pt; font-size: 8.6pt;
      white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
hr { border: 0; border-top: 1px solid #E7E9ED; margin: 14pt 0; }
a { color: #268D3C; text-decoration: none; }
strong { color: #0A0D13; }
blockquote { border-left: 3px solid #249E87; margin: 0 0 8pt; padding: 2pt 10pt; color: #6D7486; }
.cover { margin-top: 120pt; }
.cover p { color: #6D7486; }
"""

def build(md_name, pdf_name):
    src = open(os.path.join(HERE, md_name), encoding="utf-8").read()
    body = markdown.markdown(src, extensions=["tables", "fenced_code", "sane_lists"])
    html = f"<!doctype html><html><head><meta charset='utf-8'><title>{md_name}</title><style>{CSS}</style></head><body>{body}</body></html>"
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(html); tmp = f.name
    out = os.path.join(HERE, pdf_name)
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
           f"--print-to-pdf={out}", f"file://{tmp}"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    os.unlink(tmp)
    if r.returncode != 0 or not os.path.exists(out):
        print(r.stderr[-800:]); sys.exit(1)
    print("wrote", out)

if __name__ == "__main__":
    build("SRS-Fazal.md", "SRS-Fazal.pdf")
    build("SRS-Uzair.md", "SRS-Uzair.pdf")
    build("SRS-REVIEW-RESPONSE-2026-10-13.md", "SRS-REVIEW-RESPONSE-2026-10-13.pdf")
