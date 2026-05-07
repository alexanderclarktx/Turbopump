export function renderLinearMarkdown(value, fallback = "", options = {}) {
  const { images = true, links = true } = options;
  const text = String(value || fallback);
  if (!text) return "";

  const lines = text.split("\n");
  const blocks = [];
  const orderedListStarts = new Map();

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const fence = line.match(/^\s*```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const language = fence[1] ? ` data-language="${escapeAttribute(fence[1])}"` : "";
      blocks.push(`<pre class="markdown-code-block"${language}><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2], { images: false, links })}</h${level}>`);
      index += 1;
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
        /^\s*```[A-Za-z0-9_-]*\s*$/.test(current) ||
        /^(#{1,6})\s+(.+)$/.test(current) ||
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
      html += `<figure class="linear-image"><a href="${escapeAttribute(imageSrc)}" target="_blank" rel="noreferrer"><img src="${escapeAttribute(imageSrc)}" alt="${escapeAttribute(label || "Linear attachment")}" loading="lazy"></a>${label ? `<figcaption>${escapeHtml(label)}</figcaption>` : ""}</figure>`;
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
