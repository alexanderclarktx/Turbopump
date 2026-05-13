export function renderLinearMarkdown(value, fallback = "", options = {}) {
  const { images = true, links = true } = options;
  const text = String(value || fallback);
  if (!text) return "";

  const lines = text.split("\n");
  const blocks = [];
  const orderedListStarts = new Map();

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const fence = matchCodeFenceStart(line);
    if (fence) {
      const parsed = renderCodeFence(lines, index, fence);
      blocks.push(parsed.html);
      index = parsed.index;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2], { images: false, links })}</h${level}>`);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const parsed = renderTable(lines, index, { images, links });
      blocks.push(parsed.html);
      index = parsed.index;
      continue;
    }

    const list = matchListLine(line);
    if (list) {
      const orderedKey = String(list.indent);
      const startNumber = list.ordered ? (orderedListStarts.get(orderedKey) || list.number) : 1;
      const parsed = renderList(lines, index, list.indent, list.ordered, { images, links }, startNumber);
      blocks.push(parsed.html);
      if (list.ordered) orderedListStarts.set(orderedKey, startNumber + parsed.itemCount);
      index = parsed.index;
      continue;
    }

    if (!line.trim()) {
      blocks.push("<br>");
      index += 1;
      continue;
    }

    const paragraph = [];
    while (index < lines.length) {
      const current = lines[index];
      if (
        !current.trim() ||
        matchCodeFenceStart(current) ||
        /^(#{1,6})\s+(.+)$/.test(current) ||
        isTableStart(lines, index) ||
        /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.test(current)
      ) {
        break;
      }
      paragraph.push(renderInlineMarkdown(current, { images, links }));
      index += 1;
    }
    blocks.push(paragraph.join("<br>"));
  }

  return blocks.join("");
}

function matchCodeFenceStart(line) {
  const match = String(line || "").match(/^\s*(`{3,}|~{3,})\s*([^`]*)$/);
  if (!match) return null;
  const info = match[2].trim();
  const language = info.match(/^([A-Za-z0-9_+.-]+)/)?.[1] || "";
  return { marker: match[1], language };
}

function matchCodeFenceEnd(line) {
  return /^\s*(?:`{3,}|~{3,})\s*$/.test(String(line || ""));
}

function renderCodeFence(lines, startIndex, fence = matchCodeFenceStart(lines[startIndex])) {
  const codeLines = [];
  let index = startIndex + 1;
  while (index < lines.length && !matchCodeFenceEnd(lines[index])) {
    codeLines.push(lines[index]);
    index += 1;
  }
  if (index < lines.length) index += 1;
  const prismLanguage = prismLanguageName(fence?.language || "");
  const language = prismLanguage ? ` data-language="${escapeAttribute(prismLanguage)}"` : "";
  const className = prismLanguage ? ` class="language-${escapeAttribute(prismLanguage)}"` : "";
  return {
    html: `<pre class="markdown-code-block${prismLanguage ? ` language-${escapeAttribute(prismLanguage)}` : ""}"${language}><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
    index,
  };
}

function prismLanguageName(language) {
  const normalized = String(language || "").toLowerCase();
  const aliases = {
    cjs: "javascript",
    console: "shell-session",
    js: "javascript",
    jsx: "jsx",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    shell: "bash",
    text: "",
    ts: "typescript",
    tsx: "tsx",
    yml: "yaml",
  };
  return aliases[normalized] ?? normalized;
}

function isTableStart(lines, index) {
  if (index + 1 >= lines.length) return false;
  const header = parseTableRow(lines[index]);
  const delimiter = parseTableDelimiter(lines[index + 1]);
  return Boolean(header && delimiter && header.length === delimiter.length);
}

function renderTable(lines, startIndex, options) {
  const header = parseTableRow(lines[startIndex]);
  const alignments = parseTableDelimiter(lines[startIndex + 1]);
  const rows = [];
  let index = startIndex + 2;

  while (index < lines.length) {
    const row = parseTableRow(lines[index]);
    if (!row) break;
    rows.push(row);
    index += 1;
  }

  const headerHtml = header
    .map((cell, cellIndex) => renderTableCell("th", cell, alignments[cellIndex], options))
    .join("");
  const bodyHtml = rows
    .map((row) => {
      const cells = alignments.map((alignment, cellIndex) =>
        renderTableCell("td", row[cellIndex] || "", alignment, options),
      );
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  return {
    html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
    index,
  };
}

function renderTableCell(tag, value, alignment, options) {
  const align = alignment ? ` style="text-align: ${alignment}"` : "";
  return `<${tag}${align}>${renderInlineMarkdown(value.trim(), options)}</${tag}>`;
}

function parseTableRow(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) return null;
  const cells = splitTableCells(trimmed);
  return cells.length >= 2 ? cells : null;
}

function parseTableDelimiter(line) {
  const row = parseTableRow(line);
  if (!row) return null;
  const alignments = [];
  for (const cell of row) {
    const value = cell.trim();
    if (!/^:?-{2,}:?$/.test(value)) return null;
    alignments.push(value.startsWith(":") && value.endsWith(":") ? "center" : value.endsWith(":") ? "right" : "");
  }
  return alignments;
}

function splitTableCells(line) {
  const cells = [];
  let cell = "";

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && line[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell);

  if (!cells[0].trim()) cells.shift();
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
  return cells.map((value) => value.trim());
}

function renderList(lines, startIndex, indent, ordered, options, startNumber = 1) {
  const tag = ordered ? "ol" : "ul";
  const startAttribute = ordered && startNumber > 1 ? ` start="${startNumber}"` : "";
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const list = matchListLine(lines[index]);
    if (!list || list.indent !== indent || list.ordered !== ordered) break;

    index += 1;
    const parts = [renderInlineMarkdown(list.content, options)];

    while (index < lines.length) {
      const line = lines[index];
      const nextList = matchListLine(line);
      const fence = matchCodeFenceStart(line);

      if (fence) {
        const parsed = renderCodeFence(lines, index, fence);
        parts.push(parsed.html);
        index = parsed.index;
        continue;
      }

      if (!line.trim()) {
        const nextContentIndex = nextNonBlankLineIndex(lines, index + 1);
        if (nextContentIndex === -1) {
          index = lines.length;
          break;
        }
        const nextContentList = matchListLine(lines[nextContentIndex]);
        if (
          nextContentList &&
          nextContentList.indent === indent &&
          nextContentList.ordered === ordered
        ) {
          index = nextContentIndex;
          break;
        }
        if (ordered && nextContentList && !nextContentList.ordered && nextContentList.indent >= indent) {
          index = nextContentIndex;
          continue;
        }
        if (nextContentList && nextContentList.indent > indent) {
          index = nextContentIndex;
          continue;
        }
        if (ordered && !nextContentList) {
          index += 1;
          continue;
        }
        index += 1;
        break;
      }

      if (nextList) {
        if (nextList.indent === indent && nextList.ordered === ordered) break;
        if (ordered && !nextList.ordered && nextList.indent >= indent) {
          const nested = renderList(lines, index, nextList.indent, nextList.ordered, options, nextList.number);
          parts.push(nested.html);
          index = nested.index;
          continue;
        }
        if (nextList.indent > indent) {
          const nested = renderList(lines, index, nextList.indent, nextList.ordered, options, nextList.number);
          parts.push(nested.html);
          index = nested.index;
          continue;
        }
        break;
      }

      const lineIndent = leadingSpaceCount(line);
      if (ordered && lineIndent >= indent) {
        const continuationStart = lineIndent > indent ? Math.min(line.length, indent + 2) : indent;
        parts.push(`<br>${renderInlineMarkdown(line.slice(continuationStart), options)}`);
        index += 1;
        continue;
      }
      if (lineIndent > indent) {
        parts.push(`<br>${renderInlineMarkdown(line.slice(Math.min(line.length, indent + 2)), options)}`);
        index += 1;
        continue;
      }

      break;
    }

    items.push(`<li>${parts.join("")}</li>`);
  }

  return { html: `<${tag}${startAttribute}>${items.join("")}</${tag}>`, index, itemCount: items.length };
}

function matchListLine(line) {
  const match = line.match(/^(\s*)(?:([-*+])|(\d+)[.)])\s+(.+)$/);
  if (!match) return null;
  return {
    indent: leadingSpaceCount(match[1]),
    ordered: Boolean(match[3]),
    number: match[3] ? Number(match[3]) : 1,
    content: match[4],
  };
}

function leadingSpaceCount(value) {
  return String(value || "").replaceAll("\t", "    ").match(/^ */)[0].length;
}

function nextNonBlankLineIndex(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].trim()) return index;
  }
  return -1;
}

export function renderInlineMarkdown(value, options = {}) {
  const { images = true, links = true } = options;
  const text = String(value || "");
  const markdownPattern =
    /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(!?)\[([^\]]+)\]\(\s*(?:<((?:https?:\/\/|\/)[^>]+)>|((?:https?:\/\/|\/)[^)>\s]+))\s*\)|(https?:\/\/[^\s<>()]+)/g;
  let cursor = 0;
  let html = "";

  for (const match of text.matchAll(markdownPattern)) {
    const [markdown, code, bold, imageMarker, label, angleUrl, plainUrl, bareUrl] = match;
    const url = angleUrl || plainUrl || bareUrl;
    html += escapeHtml(text.slice(cursor, match.index));

    if (code !== undefined) {
      html += `<code>${escapeHtml(code)}</code>`;
    } else if (bold !== undefined) {
      html += `<strong>${escapeHtml(bold)}</strong>`;
    } else if (imageMarker && images) {
      const imageSrc = linearImageSource(url);
      html += `<figure class="linear-image"><a href="${escapeAttribute(imageSrc)}" data-image-preview data-image-preview-alt="${escapeAttribute(label || "Linear attachment")}"><img src="${escapeAttribute(imageSrc)}" alt="${escapeAttribute(label || "Linear attachment")}" loading="lazy"></a>${label ? `<figcaption>${escapeHtml(label)}</figcaption>` : ""}</figure>`;
    } else if (links) {
      html += `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(label || url)}</a>`;
    } else {
      html += escapeHtml(markdown);
    }

    cursor = match.index + markdown.length;
  }

  html += escapeHtml(text.slice(cursor));
  return html;
}

export function linearImageSource(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "uploads.linear.app") {
      return `/api/linear/attachment?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }
  return url;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
