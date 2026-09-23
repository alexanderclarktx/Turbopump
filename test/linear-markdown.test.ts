import { describe, expect, test } from "bun:test";
import {
  linearImageSource,
  renderInlineMarkdown,
  renderJsonObject,
  renderLinearMarkdown,
  renderTextWithSentenceBreaks,
} from "../public/linear-markdown.js";

describe("renderLinearMarkdown", () => {
  test("styles double quotes separately and keeps quote markers together", () => {
    expect(renderLinearMarkdown("> single\n>> abc\n>>> **nested**\n> single again")).toBe(
      '<blockquote>&gt; single<br><span class="markdown-nested-quote">&gt;&gt; abc</span><br><span class="markdown-nested-quote">&gt;&gt;&gt; <strong>nested</strong></span><br>&gt; single again</blockquote>',
    );
  });

  test("omits empty table headers while preserving status rows", () => {
    const html = renderLinearMarkdown("| | |\n| --- | --- |\n| Account | ChatGPT |\n| Credits | 42 |\n| until 09/20 | 80% |");
    expect(html).toContain("<tbody><tr><td>Account</td><td>ChatGPT</td></tr>");
    expect(html).toContain("<tr><td>Credits</td><td>42</td></tr>");
    expect(html).toContain("<tr><td>until 09/20</td><td>80%</td></tr>");
    expect(html).not.toContain("<thead>");
  });

  test("renders standard Markdown links", () => {
    const html = renderLinearMarkdown("Open [Example](https://app.example.com/messages/123).");

    expect(html).toContain('<a href="https://app.example.com/messages/123"');
    expect(html).toContain(">Example</a>");
    expect(html).not.toContain("[Example]");
  });

  test("renders Markdown links with angle-bracketed URLs", () => {
    const url = "https://app.example.com/messages/98bad810-a2c7-4eb9-ab23-f5d51d974aed";
    const html = renderLinearMarkdown(`Having issues [${url}](<${url}>)`);

    expect(html).toContain(`<a href="${url}"`);
    expect(html).toContain(`>${url}</a>`);
    expect(html).not.toContain("](<");
  });

  test("renders local file links as inline code", () => {
    const html = renderLinearMarkdown(
      "- [use-is-unread-at-navigation.ts](/Users/alex/project/src/app/(protected)/[workspaceId]/(main)/components/conversation-view/use-is-unread-at-navigation.ts:13) latches unread state.",
    );

    expect(html).toContain("<li><code>use-is-unread-at-navigation.ts</code> latches unread state.</li>");
    expect(html).not.toContain("<a href=");
    expect(html).not.toContain("/[workspaceId]/(main)");
  });

  test("renders angle-bracketed local file links as inline code", () => {
    const html = renderLinearMarkdown("[My File](</Users/alex/My Project/file.ts:201>)");

    expect(html).toBe("<code>My File</code>");
    expect(html).not.toContain("<a href=");
  });

  test("renders bare URLs", () => {
    const html = renderLinearMarkdown("See https://platform.claude.com/workspaces/default/sessions/sess_123");

    expect(html).toContain('<a href="https://platform.claude.com/workspaces/default/sessions/sess_123"');
  });

  test("leaves trailing punctuation out of bare URLs", () => {
    const url = "http://dev.example.com:3000/example-corp/2c177334-0cca-40ed-b29a-45c3a55069da";
    const html = renderLinearMarkdown(`"href": "${url}",`);

    expect(html).toContain(`<a href="${url}"`);
    expect(html).toContain(`>${url}</a>",`);
    expect(html).not.toContain(`href="${url}&quot;,`);
  });

  test("renders Linear upload images through the local attachment proxy", () => {
    const url = "https://uploads.linear.app/workspace/file/image.png";
    const html = renderLinearMarkdown(`![Screenshot](${url})`);
    const proxied = `/api/linear/attachment?url=${encodeURIComponent(url)}`;

    expect(html).toContain('<figure class="linear-image">');
    expect(html).toContain(`src="${proxied}"`);
    expect(html).toContain(`href="${proxied}" data-image-preview data-image-preview-alt="Screenshot"`);
    expect(html).toContain('alt="Screenshot"');
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain("\n        <figure");
  });

  test("renders images through a custom source", () => {
    const path = "/workspace/artifacts/proof.png";
    const html = renderLinearMarkdown(`- [Proof](<${path}>)`, "", {
      imageSource: (url) => `/preview?path=${encodeURIComponent(url)}`,
    });

    expect(html).toContain("<ul><li><figure");
    expect(html).toContain(`src="/preview?path=${encodeURIComponent(path)}"`);
    expect(html).not.toContain("<code>");
  });

  test("renders linked images without leaking the outer link", () => {
    const path = "/workspace/artifacts/proof.png";
    const html = renderLinearMarkdown(`[![Proof](<${path}>)](<${path}>)`, "", {
      imageSource: (url) => `/preview?path=${encodeURIComponent(url)}`,
    });

    expect(html).toContain(`<figcaption>Proof</figcaption>`);
    expect(html).toContain(`src="/preview?path=${encodeURIComponent(path)}"`);
    expect(html).not.toContain("![Proof");
    expect(html).not.toContain("](&lt;");
  });

  test.each([
    "artifacts/custom-mcp-chat/01-connect-card.png",
    "./artifacts/setup.webp",
    "../artifacts/approval.jpg",
    "proof.png",
    "artifacts/setup (approved).png",
  ])("renders relative image links through a custom source: %s", (path) => {
    for (const message of [`[Proof](${path})`, `![Proof](<${path}>)`, `[![Proof](<${path}>)](<${path}>)`]) {
      // Paths containing spaces use Markdown's angle-bracket destination syntax.
      if (path.includes(" ") && message === `[Proof](${path})`) continue;
      const html = renderLinearMarkdown(message, "", {
        imageSource: (url) => `/preview?path=${encodeURIComponent(url)}`,
      });
      expect(html).toContain(`src="/preview?path=${encodeURIComponent(path)}"`);
      expect(html).toContain('data-image-preview');
      expect(html).toContain('<figcaption>Proof</figcaption>');
      expect(html).not.toContain("![Proof");
    }
  });

  test("renders relative report links as code and respects disabled images", () => {
    expect(renderLinearMarkdown("[Validation report](artifacts/custom-mcp-validation.md)")).toBe("<code>Validation report</code>");
    expect(renderLinearMarkdown("[Proof](artifacts/proof.png)", "", { images: false })).toBe("<code>Proof</code>");
  });

  test.each(["javascript:alert(1)", "data:image/svg+xml,test", "//example.com/proof.png", "file:///tmp/proof.png"])(
    "does not render unsupported destinations: %s", (url) => {
      const html = renderLinearMarkdown(`![Proof](${url})`);
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<a ");
    },
  );

  test("escapes non-link HTML", () => {
    const html = renderLinearMarkdown('<script>alert("x")</script>');

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("renders Markdown headings", () => {
    const html = renderLinearMarkdown("# Overview\n### Details");

    expect(html).toContain("<h1>Overview</h1>");
    expect(html).toContain("<h3>Details</h3>");
    expect(html).not.toContain("# Overview");
    expect(html).not.toContain("</h1>\n");
  });

  test("renders inline code spans", () => {
    const html = renderLinearMarkdown("Pick `apple` today.");

    expect(html).toContain("Pick <code>apple</code> today.");
    expect(html).not.toContain("`apple`");
  });

  test("breaks immediately adjacent sentences after periods", () => {
    expect(renderLinearMarkdown("Set the color.The first selection state")).toBe(
      "Set the color.<br>The first selection state",
    );
    expect(renderInlineMarkdown("Set the `color.The` value")).toBe("Set the <code>color.The</code> value");
    expect(renderTextWithSentenceBreaks("Set the color.The first selection state")).toBe(
      "Set the color.<br>The first selection state",
    );
  });

  test("renders bold text", () => {
    const html = renderLinearMarkdown("Use **Recommended MVP**.");

    expect(html).toContain("Use <strong>Recommended MVP</strong>.");
    expect(html).not.toContain("**Recommended MVP**");
  });

  test("renders emphasized text", () => {
    const html = renderLinearMarkdown("Read *East of Eden*.");

    expect(html).toContain("Read <em>East of Eden</em>.");
    expect(html).not.toContain("*East of Eden*");
  });

  test("does not parse bold text inside inline code", () => {
    const html = renderLinearMarkdown("Use `**Recommended MVP**`.");

    expect(html).toContain("<code>**Recommended MVP**</code>");
    expect(html).not.toContain("<strong>Recommended MVP</strong>");
  });

  test("renders inline code inside bold list text", () => {
    const html = renderLinearMarkdown("2. **Split the public API shapes instead of making `reactions` optional**");

    expect(html).toContain(
      "<ol start=\"2\"><li><strong>Split the public API shapes instead of making <code>reactions</code> optional</strong></li></ol>",
    );
    expect(html).not.toContain("`reactions`");
  });

  test("renders bullet and numbered lists", () => {
    const html = renderLinearMarkdown("- `apple`\n- banana\n\n1. first\n2. second");

    expect(html).toContain("<ul><li><code>apple</code></li><li>banana</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).not.toContain("- banana");
    expect(html).not.toContain("1. first");
  });

  test("can render blank lines as compact spacing", () => {
    const gap = '<br><span class="markdown-blank-line" aria-hidden="true"></span>';
    expect(renderLinearMarkdown("one\n\ntwo", "", { compactBlankLines: true })).toBe(`one${gap}two`);
    expect(renderLinearMarkdown("one\n\n\ntwo", "", { compactBlankLines: true })).toBe(`one${gap}${gap}two`);
  });

  test("renders Markdown tables", () => {
    const html = renderLinearMarkdown("confirmed\n| before | after |\n| -- | -- |\n| one | **two** |");

    expect(html).toContain('confirmed<table class="markdown-resizable-table">');
    expect(html).toContain('<colgroup><col data-markdown-column-index="0"><col data-markdown-column-index="1"></colgroup>');
    expect(html).toContain(
      '<thead><tr><th data-markdown-column-index="0"><span class="markdown-table-header-content">before</span><button class="markdown-table-column-resizer" type="button" data-markdown-column-resizer="true" aria-label="Resize column" title="Resize column"></button></th><th data-markdown-column-index="1"><span class="markdown-table-header-content">after</span><button class="markdown-table-column-resizer" type="button" data-markdown-column-resizer="true" aria-label="Resize column" title="Resize column"></button></th></tr></thead>',
    );
    expect(html).toContain("<tbody><tr><td>one</td><td><strong>two</strong></td></tr></tbody>");
    expect(html).not.toContain("| before | after |");
    expect(html).not.toContain("| -- | -- |");
  });

  test("renders images inside Markdown table cells", () => {
    const url = "https://uploads.linear.app/workspace/file/before.png";
    const html = renderLinearMarkdown(`| before | after |\n| -- | -- |\n| ![Before](${url}) | done |`);

    expect(html).toContain('<table class="markdown-resizable-table">');
    expect(html).toContain("<td><figure class=\"linear-image\">");
    expect(html).toContain(`src="/api/linear/attachment?url=${encodeURIComponent(url)}"`);
    expect(html).toContain("<td>done</td>");
  });

  test("uses authenticated GitHub attachment previews inside table cells", () => {
    const url = "https://github.com/user-attachments/assets/33002b47-bd20-4a41-8db2-b5fd97d18e5b";
    const source = `/api/github/attachment?url=${encodeURIComponent(url)}`;
    const html = renderLinearMarkdown(`| GPT Image 2 | Flare |\n|---|---|\n| ![Sample 1](${url}) | done |`);
    expect(html).toContain(`<img src="${source}"`);
    expect(html).toContain(`href="${source}" data-image-preview`);
    expect(html).toContain('<td><figure class="linear-image">');
  });

  test("keeps repeated ordered list markers numbered across nested bullets", () => {
    const html = renderLinearMarkdown("Plan:\n1. Add\n   - legacy\n   - image\n\n1. Update\n   - top\n\n1. Validate");

    expect(html).toContain(
      "Plan:<ol><li>Add<ul><li>legacy</li><li>image</li></ul></li><li>Update<ul><li>top</li></ul></li><li>Validate</li></ol>",
    );
    expect(html.match(/<ol>/g)).toHaveLength(1);
    expect(html).not.toContain("1. Update");
  });

  test("continues repeated ordered list markers across intervening paragraphs", () => {
    const html = renderLinearMarkdown("1. Add\nDetails\n- requested\n\n1. Update\nMore detail\n\n1. Validate");

    expect(html).toContain("<ol><li>Add<br>Details<ul><li>requested</li></ul></li><li>Update<br>More detail</li><li>Validate</li></ol>");
    expect(html.match(/<ol>/g)).toHaveLength(1);
    expect(html).not.toContain("1. Update");
    expect(html).not.toContain("1. Validate");
  });

  test("keeps follow-up bullets visually under repeated numbered items", () => {
    const html = renderLinearMarkdown(
      "1. Fix added\nThe reviewer is right:\n- requested: all resources\n- added: only principals\n\n1. Move workspace\nThen the MCP tool only needs:\n- parallel lookup behavior\n- already-member behavior",
    );

    expect(html).toContain(
      "<ol><li>Fix added<br>The reviewer is right:<ul><li>requested: all resources</li><li>added: only principals</li></ul></li><li>Move workspace<br>Then the MCP tool only needs:<ul><li>parallel lookup behavior</li><li>already-member behavior</li></ul></li></ol>",
    );
    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(html).not.toContain("<ol start=");
  });

  test("ends ordered lists before separate unindented paragraphs and headings", () => {
    const html = renderLinearMarkdown(
      "It awaits:\n\n1. `createOrReuseCallSessionInternal`\n2. `generateLiveKitCredentials`\n3. return `{ call, credentials }`\n\nSo if the client API phase is slow, check credentials.\n\n**Highest Impact Changes**\n\n1. Defer jam message side effects.",
    );

    expect(html).toContain(
      "<ol><li><code>createOrReuseCallSessionInternal</code></li><li><code>generateLiveKitCredentials</code></li><li>return <code>{ call, credentials }</code></li></ol>",
    );
    expect(html).toContain("</ol>So if the client API phase is slow, check credentials.");
    expect(html).toContain("<strong>Highest Impact Changes</strong>");
    expect(html).toContain("<ol><li>Defer jam message side effects.</li></ol>");
    expect(html).not.toContain("<ol start=");
    expect(html).not.toContain("<li>return <code>{ call, credentials }</code><br>");
  });

  test("renders fenced code blocks while escaping HTML", () => {
    const html = renderLinearMarkdown("```ts\nconst apple = `<red>`;\n```");

    expect(html).toContain('<pre class="markdown-code-block language-typescript" data-language="typescript">');
    expect(html).toContain('class="markdown-code-copy"');
    expect(html).toContain('data-code-copy="true"');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain("<svg ");
    expect(html).toContain('<rect x="6.25" y="2.25" width="7.25" height="7.25" rx="1.4"/>');
    expect(html).toContain('<rect x="2.5" y="6" width="7.25" height="7.25" rx="1.4"/>');
    expect(html).not.toContain(">Copy code</button>");
    expect(html).toContain('<code class="language-typescript">');
    expect(html).toContain("const apple = `&lt;red&gt;`;");
    expect(html).toContain("</code></pre>");
    expect(html).not.toContain("<red>");
  });

  test("can render fenced code blocks without copy controls", () => {
    const html = renderLinearMarkdown("```ts\nconst apple = 1;\n```", "", { copyCode: false });

    expect(html).toContain('<pre class="markdown-code-block language-typescript" data-language="typescript">');
    expect(html).not.toContain('class="markdown-code-copy"');
    expect(html).not.toContain('data-code-copy="true"');
    expect(html).toContain('<code class="language-typescript">const apple = 1;</code></pre>');
  });

  test("renders fenced code blocks with common info strings", () => {
    const html = renderLinearMarkdown(
      "```text\nError calling MCP tool ...\n```\n\n```json\n{\"error\":{\"code\":-32003}}\n```",
    );

    expect(html).toContain('<pre class="markdown-code-block"><button class="markdown-code-copy"');
    expect(html).toContain("<code>Error calling MCP tool ...");
    expect(html).toContain("Error calling MCP tool ...");
    expect(html).toContain('class="markdown-code-block markdown-json-block"');
    expect(html).toContain('<summary><span class="markdown-json-key">error</span>: <span class="markdown-json-bracket-object">{</span><span class="markdown-json-collapsed-preview"> <span class="markdown-json-key">code</span> <span class="markdown-json-bracket-object">}</span></span></summary>');
    expect(html).toContain('<code><span class="markdown-json-key">code</span>:<span class="markdown-json-value-token">-32003</span></code>');
    expect(html).not.toContain("```text");
    expect(html).not.toContain("```json");
  });

  test("renders fenced code blocks inside numbered list items", () => {
    const html = renderLinearMarkdown(
      "1. initialize\n2. notifications/initialized\n3. tools/call\n4. DELETE session in finally\nIf tools/call gets 400, execute wraps it as:\n```text\nError calling MCP tool ...\n```\n\nThe wrapper can retry.",
    );

    expect(html).toContain('<li>DELETE session in finally<br>If tools/call gets 400, execute wraps it as:<pre class="markdown-code-block"><button class="markdown-code-copy"');
    expect(html).toContain("<code>Error calling MCP tool ...</code></pre></li>");
    expect(html).toContain("</ol>The wrapper can retry.");
    expect(html).not.toContain("```text");
  });

  test("does not parse Markdown inside fenced code blocks", () => {
    const html = renderLinearMarkdown("```\n# apple\n- banana\n`pear`\n```");

    expect(html).toContain("# apple\n- banana\n`pear`");
    expect(html).not.toContain("<h1>apple</h1>");
    expect(html).not.toContain("<li>banana</li>");
    expect(html).not.toContain("<code>pear</code>");
  });
});

describe("collapsible JSON containers", () => {
  test("keeps every bracket neutral and limits expandable hover color to its key", async () => {
    const css = await Bun.file("public/styles.css").text();
    expect(css).toContain(".markdown-json-bracket-array {\n  color: var(--terminal-ink);\n}");
    expect(css).toContain(".markdown-json-bracket-object {\n  color: var(--terminal-ink);\n}");
    expect(css).toContain(".markdown-json-field > summary:hover > .markdown-json-key {\n  color: var(--accent);\n}");
    expect(css).not.toContain(".markdown-json-field > summary:hover {\n");
    expect(css).toContain("color: var(--terminal-ink);");
  });

  test("previews every immediate object key while preserving duplicates and escaping HTML", () => {
    const source = '[{"a":{"hidden":1},"b":[{"hidden":2}],"c":null,"a":3,"<script>":4,"line\\nbreak":5}]';
    const html = renderLinearMarkdown(source);
    expect(html).toContain('<summary><span class="markdown-json-bracket-object">{</span><span class="markdown-json-collapsed-preview"> <span class="markdown-json-key">a</span>, <span class="markdown-json-key">b</span>, <span class="markdown-json-key">c</span>, <span class="markdown-json-key">a</span>, <span class="markdown-json-key">&lt;script&gt;</span>, <span class="markdown-json-key">line\\nbreak</span> <span class="markdown-json-bracket-object">}</span></span></summary>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<span class="markdown-json-value-token">4</span>');
  });

  test.each(["bare", "embedded", "json", "unlabeled"])("renders a top-level array as one block in %s JSON", (format) => {
    const source = '[\n  {\n    "text": "brackets ] } and \\\"quotes\\\"",\n    "attachments": [\n      {"kind": "image"}\n    ]\n  },\n  {"text": "second", "attachments": []}\n]';
    const input = format === "bare" ? source
      : format === "embedded" ? `**Before**\n${source}\n**After**`
      : `\`\`\`${format === "json" ? "json" : ""}\n${source}\n\`\`\``;
    const html = renderLinearMarkdown(input);
    expect(html.match(/class="markdown-code-block markdown-json-block"/g)).toHaveLength(1);
    expect(html.match(/data-code-copy=/g)).toHaveLength(1);
    expect(html.match(/<details /g)).toHaveLength(2);
    expect(html).toContain('<div><span class="markdown-json-bracket-array">[</span></div><div class="markdown-json-fields markdown-json-array-fields">');
    expect(html).toContain('<span class="markdown-json-key">text</span>, <span class="markdown-json-key">attachments</span>');
    expect(html).toContain(`data-code-source="${source.replaceAll('"', '&quot;')}"`);
    expect(html).toContain('</div><div><span class="markdown-json-bracket-array">]</span></div></div>');
    if (format === "embedded") {
      expect(html).toStartWith('<strong>Before</strong><div class="markdown-code-block');
      expect(html).toEndWith('<strong>After</strong>');
    }
  });

  test("supports empty arrays, scalars, and nested arrays without losing source values", () => {
    const source = '[9007199254740993,1e1000,"a,b",true,null,[],["a,b",{"nested":[1,2]},[],null,true],{"a":1,"a":2}]';
    const html = renderJsonObject(source, { copyCode: false });
    expect(html).not.toContain('data-code-copy');
    expect(html.match(/<details /g)).toHaveLength(3);
    for (const scalar of ['9007199254740993', '1e1000', 'a,b', 'true', 'null']) {
      expect(html).toContain(`<div class="markdown-json-scalar"><span class="markdown-json-value-token">${scalar}</span>,</div>`);
    }
    expect(html).toContain('<summary><span class="markdown-json-bracket-array">[</span><span class="markdown-json-collapsed-preview"><span class="markdown-json-bracket-array">]</span>,</span></summary>');
    expect(html).toContain('<summary><span class="markdown-json-bracket-array">[</span><span class="markdown-json-collapsed-preview">5<span class="markdown-json-bracket-array">]</span>,</span></summary>');
    expect(html).toContain('<code><span class="markdown-json-key">a</span>:<span class="markdown-json-value-token">1</span>');
    expect(renderJsonObject('[]')).toContain('<div><span class="markdown-json-bracket-array">[</span></div><div class="markdown-json-fields markdown-json-array-fields"></div><div><span class="markdown-json-bracket-array">]</span></div>');
  });

  test("collapses pasted JSON between message text without requiring fences or blank lines", () => {
    const html = renderLinearMarkdown('Please inspect this:\n{\n  "a": {"text": "a } and \\\"b\\\""},\n  "b": [1, {"c": 2}]\n}\nWhat should I change?');
    expect(html).toStartWith('Please inspect this:<div class="markdown-code-block markdown-json-block"');
    expect(html).toContain('<summary><span class="markdown-json-key">a</span>: <span class="markdown-json-bracket-object">{</span><span class="markdown-json-collapsed-preview"> <span class="markdown-json-key">text</span> <span class="markdown-json-bracket-object">}</span>,</span></summary>');
    expect(html).toContain('<summary><span class="markdown-json-key">b</span>: <span class="markdown-json-bracket-array">[</span><span class="markdown-json-collapsed-preview">2<span class="markdown-json-bracket-array">]</span></span></summary>');
    expect(html).toEndWith('What should I change?');
    expect(html.match(/<details /g)).toHaveLength(2);
  });

  test("handles multiple pasted objects and preserves surrounding Markdown", () => {
    const html = renderLinearMarkdown('**Before**\n{"a":{}}\nBetween\n{"b":[]}\n**After**', "", { copyCode: false });
    expect(html).toStartWith('<strong>Before</strong>');
    expect(html).toContain('<summary><span class="markdown-json-key">a</span>: <span class="markdown-json-bracket-object">{</span><span class="markdown-json-collapsed-preview"><span class="markdown-json-bracket-object">}</span></span></summary>');
    expect(html).toContain('Between<div class="markdown-code-block');
    expect(html).toContain('<summary><span class="markdown-json-key">b</span>: <span class="markdown-json-bracket-array">[</span><span class="markdown-json-collapsed-preview"><span class="markdown-json-bracket-array">]</span></span></summary>');
    expect(html).toEndWith('<strong>After</strong>');
    expect(html).not.toContain('data-code-copy');
  });

  test.each(['{"a":', '{"a":1,}', '{example}', '{"a":{}} trailing text', '{"a":"broken\nstring"}'])(
    "keeps invalid or incomplete pasted objects as text: %s", (source) => {
      const html = renderLinearMarkdown(`Before\n${source}\nAfter`);
      expect(html).not.toContain('<details');
      expect(html).toStartWith('Before<br>');
      expect(html).toEndWith('<br>After');
    },
  );

  test.each(["bare", "json", "unlabeled"])("collapses top-level containers in %s JSON", (format) => {
    const source = '{"a":{"nested":{"value":1}},"b":[1,2],"ready":true,"empty":null}';
    const input = format === "bare" ? source : `\`\`\`${format === "json" ? "json" : ""}\n${source}\n\`\`\``;
    const html = renderLinearMarkdown(input);
    expect(html.match(/<details /g)).toHaveLength(2);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain('<summary><span class="markdown-json-key">a</span>: <span class="markdown-json-bracket-object">{</span><span class="markdown-json-collapsed-preview"> <span class="markdown-json-key">nested</span> <span class="markdown-json-bracket-object">}</span>,</span></summary>');
    expect(html).toContain('<summary><span class="markdown-json-key">b</span>: <span class="markdown-json-bracket-array">[</span><span class="markdown-json-collapsed-preview">2<span class="markdown-json-bracket-array">]</span>,</span></summary>');
    expect(html).toContain('<span class="markdown-json-key">value</span>:<span class="markdown-json-value-token">1</span>');
    expect(html).toContain('<div class="markdown-json-scalar"><span class="markdown-json-key">ready</span>: <span class="markdown-json-value-token">true</span>,</div>');
    expect(html).toContain('<div class="markdown-json-scalar"><span class="markdown-json-key">empty</span>: <span class="markdown-json-value-token">null</span></div>');
  });

  test("preserves source numbers, duplicate keys, escaped strings, and copy text", () => {
    const source = '{"a":{"id":9007199254740993,"text":"},[\\\""},"a":[1e1000],"text":"a,b"}';
    const html = renderJsonObject(source);
    expect(html.match(/<details /g)).toHaveLength(2);
    expect(html).toContain('9007199254740993');
    expect(html).toContain('[1e1000]');
    expect(html).toContain(`data-code-source="${source.replaceAll('"', '&quot;')}"`);
    expect(html).toContain('<span class="markdown-json-key">text</span>: <span class="markdown-json-value-token">a,b</span>');
  });

  test("omits only enclosing string quotes", () => {
    const html = renderJsonObject('{"message":"say \\"hello\\""}', { copyCode: false });
    expect(html).toContain('<span class="markdown-json-key">message</span>: <span class="markdown-json-value-token">say \\"hello\\"</span>');
  });

  test("renders adjacent expanded array objects as }, {", () => {
    const html = renderJsonObject('{"messages":[{"id":1},\n  {"id":2}]}', { copyCode: false });
    expect(html).toContain('</span>}, {<span class="markdown-json-key">id</span>');
  });

  test("hides an object's collapsed preview while retaining its opening bracket", () => {
    const html = renderJsonObject('{"message":{"author":"Calcifer","created_at":"today"}}', { copyCode: false });
    expect(html).toContain('<summary><span class="markdown-json-key">message</span>: <span class="markdown-json-bracket-object">{</span><span class="markdown-json-collapsed-preview">');
    expect(html).toContain('<code><span class="markdown-json-key">author</span>:<span class="markdown-json-value-token">Calcifer</span>');
    expect(html).toContain('<div class="markdown-json-expanded-close"><span class="markdown-json-bracket-object">}</span></div>');
  });

  test("escapes keys and values and supports empty containers", () => {
    const html = renderJsonObject('{"<img src=x onerror=alert(1)>":{},"b":[],"text":"<script>&"}');
    expect(html).toContain('<summary><span class="markdown-json-key">&lt;img src=x onerror=alert(1)&gt;</span>: <span class="markdown-json-bracket-object">{</span><span class="markdown-json-collapsed-preview"><span class="markdown-json-bracket-object">}</span>,</span></summary>');
    expect(html).toContain('<summary><span class="markdown-json-key">b</span>: <span class="markdown-json-bracket-array">[</span><span class="markdown-json-collapsed-preview"><span class="markdown-json-bracket-array">]</span>,</span></summary>');
    expect(html).toContain('&lt;script&gt;&amp;');
    expect(html).not.toContain('<img');
    expect(renderJsonObject('{}')).not.toContain('<details');
  });

  test.each(['{"a":', '{"a":1,}', 'null', '[{"a":1}', '[1,]', '[}', '{example}', 'Before {"a":{}}']) (
    "leaves incomplete, invalid, and non-container input alone: %s", (source) => {
      expect(renderJsonObject(source)).toBe("");
      expect(renderLinearMarkdown(`\`\`\`json\n${source}\n\`\`\``)).toContain('<pre class="markdown-code-block language-json"');
    },
  );

  test("respects copy controls and explicit non-JSON code languages", () => {
    expect(renderLinearMarkdown('{"a":{}}', "", { copyCode: false })).not.toContain('data-code-copy');
    expect(renderLinearMarkdown('```json\n{"a":{}}\n```', "", { copyCode: false })).not.toContain('data-code-copy');
    expect(renderLinearMarkdown('```text\n{"a":{}}\n```')).not.toContain('<details');
  });
});

describe("renderInlineMarkdown", () => {
  test("keeps images out of file cards when a file preview source is available", () => {
    const options = {
      fileSource: (path: string) => `/file?path=${encodeURIComponent(path)}`,
      imageSource: (path: string) => `/image?path=${encodeURIComponent(path)}`,
    };
    for (const value of ["[Screenshot](proof.png)", "![Screenshot](proof.png)", "![Screenshot](image-without-extension)"]) {
      const html = renderInlineMarkdown(value, options);
      expect(html).toContain('<figure class="linear-image">');
      expect(html).toContain("data-image-preview");
      expect(html).not.toContain("file-link-card");
      expect(renderInlineMarkdown(value, { ...options, images: false })).not.toContain("file-link-card");
    }
  });
  test.each(["artifacts/report.md", "/repo/src/app.ts:12", "src/app.ts#L12", "./report (final).md"])("renders file cards with a preview source: %s", (path) => {
    const html = renderInlineMarkdown(`[View](<${path}>)`, { fileSource: (path) => `/preview?path=${encodeURIComponent(path)}` });
    expect(html).toContain('class="file-link-card"');
    expect(html).toContain('data-file-preview ');
    expect(html).toContain(`href="/preview?path=${encodeURIComponent(path)}"`);
    expect(html).toContain('<span class="file-link-label">View</span>');
    expect(html.replace(/<[^>]+>/g, "")).toBe("View");
    expect(html).not.toContain('target="_blank"');
  });
  test("keeps unsafe links and code out of file cards", () => {
    const options = { fileSource: (path: string) => path };
    for (const value of ["[Bad](javascript:alert(1))", "[Bad](//example.com/file)", "`[Code](report.md)`"]) {
      expect(renderInlineMarkdown(value, options)).not.toContain('class="file-link-card"');
    }
    expect(renderInlineMarkdown("[Report](report.md)", { ...options, links: false })).not.toContain('data-file-preview');
  });
  test("renders inline code while escaping HTML", () => {
    const html = renderInlineMarkdown("Use `<apple>`.");

    expect(html).toContain("<code>&lt;apple&gt;</code>");
    expect(html).not.toContain("<apple>");
  });

  test("can leave links as plain escaped markdown", () => {
    const html = renderInlineMarkdown("See [Example](https://app.example.com)", { links: false });

    expect(html).toBe("See [Example](https://app.example.com)");
  });
});

describe("linearImageSource", () => {
  test("proxies Linear upload URLs", () => {
    const url = "https://uploads.linear.app/workspace/file/image.png";

    expect(linearImageSource(url)).toBe(`/api/linear/attachment?url=${encodeURIComponent(url)}`);
  });

  test("leaves non-Linear image URLs alone", () => {
    const url = "https://example.com/image.png";

    expect(linearImageSource(url)).toBe(url);
  });
});
