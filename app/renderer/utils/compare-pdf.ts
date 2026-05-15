import type { ExperimentCompareResult } from "@/service/services/ask-service";

const escapeHTML = (value: string) =>
  `${value || ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const slugify = (value: string) =>
  `${value || "experiment-comparison"}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "experiment-comparison";

const valueFor = (
  result: ExperimentCompareResult,
  rowIndex: number,
  columnId: string
) => {
  const row = result.rows[rowIndex];
  return `${row?.values?.[columnId] || "-"}`.trim() || "-";
};

const groupedColumns = (result: ExperimentCompareResult) => {
  const groups: Array<{ label: string; span: number }> = [];
  for (const column of result.columns || []) {
    const label = column.group || "Results";
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.span += 1;
    } else {
      groups.push({ label, span: 1 });
    }
  }
  return groups;
};

export const comparePDFFileName = (result: ExperimentCompareResult) =>
  `${slugify(result.title)}.pdf`;

export const buildComparePDFHTML = (result: ExperimentCompareResult) => {
  const paperRows = (result.papers || [])
    .map(
      (paper, index) => `
        <li>
          <span class="paper-index">[${index + 1}]</span>
          ${escapeHTML(paper.title)}
          ${
            paper.year || paper.publication
              ? `<span class="paper-meta">${escapeHTML(
                  [paper.year, paper.publication].filter(Boolean).join(", ")
                )}</span>`
              : ""
          }
        </li>`
    )
    .join("");

  const table =
    result.columns.length > 0 && result.rows.length > 0
      ? `
        <table>
          <thead>
            <tr>
              <th rowspan="2">Paper</th>
              <th rowspan="2">Method</th>
              <th rowspan="2">Setting</th>
              ${groupedColumns(result)
                .map(
                  (group) =>
                    `<th class="center" colspan="${group.span}">${escapeHTML(
                      group.label
                    )}</th>`
                )
                .join("")}
              <th rowspan="2">Source</th>
            </tr>
            <tr>
              ${result.columns
                .map(
                  (column) =>
                    `<th class="center">${escapeHTML(column.label)}</th>`
                )
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${result.rows
              .map(
                (row, rowIndex) => `
                  <tr class="${row.role === "proposed" ? "proposed" : ""}">
                    <td title="${escapeHTML(row.paperTitle)}">[${
                  row.paperIndex
                }]</td>
                    <td>
                      ${escapeHTML(row.method)}
                      ${
                        row.role !== "other"
                          ? `<span class="role">${escapeHTML(row.role)}</span>`
                          : ""
                      }
                    </td>
                    <td>${escapeHTML(row.setting || "-")}</td>
                    ${result.columns
                      .map(
                        (column) => `
                          <td class="center ${
                            row.best?.[column.id] ? "best" : ""
                          }">
                            ${escapeHTML(valueFor(result, rowIndex, column.id))}
                          </td>`
                      )
                      .join("")}
                    <td>${escapeHTML(row.source || "-")}</td>
                  </tr>`
              )
              .join("")}
          </tbody>
        </table>`
      : `<p class="muted">No explicit experiment table was found in the selected papers.</p>`;

  const warnings = (result.warnings || [])
    .map((warning) => `<li>${escapeHTML(warning)}</li>`)
    .join("");
  const notes = (result.notes || [])
    .map((note) => `<li>${escapeHTML(note)}</li>`)
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHTML(result.title || "Experiment Comparison")}</title>
  <style>
    @page { size: A4 landscape; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      color: #111827;
      font-family: "Latin Modern Roman", "Computer Modern Serif", "Computer Modern",
        "CMU Serif", "KaTeX_Main", "Times New Roman", Times, serif;
      font-size: 10.5px;
      line-height: 1.35;
      margin: 0;
    }
    h1 {
      font-size: 17px;
      font-weight: 700;
      line-height: 1.2;
      margin: 0 0 7px;
      text-align: center;
    }
    .meta {
      color: #4b5563;
      font-size: 9.5px;
      margin-bottom: 12px;
      text-align: center;
    }
    ol {
      margin: 0 0 12px 0;
      padding: 0;
      list-style: none;
    }
    li { margin-bottom: 3px; }
    .paper-index { font-weight: 700; margin-right: 4px; }
    .paper-meta { color: #6b7280; margin-left: 6px; }
    table {
      width: 100%;
      border-collapse: collapse;
      border-top: 1.2px solid #111827;
      border-bottom: 1.2px solid #111827;
      margin-top: 10px;
    }
    thead tr:first-child { border-bottom: 0.7px solid #9ca3af; }
    thead tr:last-child { border-bottom: 0.9px solid #111827; }
    tbody tr { border-top: 1px solid #e5e7eb; }
    th, td {
      padding: 3px 4px;
      text-align: left;
      vertical-align: top;
    }
    th {
      font-weight: 700;
      background: transparent;
    }
    .center { text-align: center; }
    .proposed { background: #f3f4f6; }
    .best { font-weight: 800; }
    .role {
      border: 1px solid #d1d5db;
      border-radius: 3px;
      color: #4b5563;
      font-size: 8px;
      margin-left: 4px;
      padding: 1px 3px;
      text-transform: lowercase;
    }
    .section-title {
      font-weight: 700;
      margin: 12px 0 4px;
    }
    .muted { color: #6b7280; }
    .warning { color: #92400e; }
  </style>
</head>
<body>
  <h1>${escapeHTML(result.title || "Experiment Comparison")}</h1>
  ${
    result.generatedAt
      ? `<div class="meta">Generated at ${escapeHTML(
          new Date(result.generatedAt).toLocaleString()
        )}</div>`
      : ""
  }
  ${paperRows ? `<ol>${paperRows}</ol>` : ""}
  ${table}
  ${
    warnings
      ? `<div class="section-title warning">Warnings</div><ul class="warning">${warnings}</ul>`
      : ""
  }
  ${notes ? `<div class="section-title muted">Notes</div><ul>${notes}</ul>` : ""}
</body>
</html>`;
};

export const downloadComparePDF = async (result: ExperimentCompareResult) =>
  PLMainAPI.fileSystemService.saveHTMLAsPDF(
    buildComparePDFHTML(result),
    comparePDFFileName(result)
  );
