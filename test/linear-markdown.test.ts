import { describe, expect, test } from "bun:test";
import {
  linearImageSource,
  renderInlineMarkdown,
  renderLinearMarkdown,
  renderTextWithSentenceBreaks,
} from "../public/linear-markdown.js";

describe("renderLinearMarkdown", () => {
  test("renders standard Markdown links", () => {
    const html = renderLinearMarkdown("Open [Ando](https://app.ando.so/messages/123).");

    expect(html).toContain('<a href="https://app.ando.so/messages/123"');
    expect(html).toContain(">Ando</a>");
    expect(html).not.toContain("[Ando]");
  });

  test("renders Markdown links with angle-bracketed URLs", () => {
    const url = "https://app.ando.so/messages/98bad810-a2c7-4eb9-ab23-f5d51d974aed";
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

    expect(html).toContain("confirmed<table>");
    expect(html).toContain("<thead><tr><th>before</th><th>after</th></tr></thead>");
    expect(html).toContain("<tbody><tr><td>one</td><td><strong>two</strong></td></tr></tbody>");
    expect(html).not.toContain("| before | after |");
    expect(html).not.toContain("| -- | -- |");
  });

  test("renders images inside Markdown table cells", () => {
    const url = "https://uploads.linear.app/workspace/file/before.png";
    const html = renderLinearMarkdown(`| before | after |\n| -- | -- |\n| ![Before](${url}) | done |`);

    expect(html).toContain("<table>");
    expect(html).toContain("<td><figure class=\"linear-image\">");
    expect(html).toContain(`src="/api/linear/attachment?url=${encodeURIComponent(url)}"`);
    expect(html).toContain("<td>done</td>");
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

    expect(html).toContain('<pre class="markdown-code-block language-typescript" data-language="typescript"><code class="language-typescript">');
    expect(html).toContain("const apple = `&lt;red&gt;`;");
    expect(html).toContain("</code></pre>");
    expect(html).not.toContain("<red>");
  });

  test("renders fenced code blocks with common info strings", () => {
    const html = renderLinearMarkdown(
      "```text\nError calling Ando MCP tool ...\n```\n\n```json\n{\"error\":{\"code\":-32003}}\n```",
    );

    expect(html).toContain('<pre class="markdown-code-block"><code>');
    expect(html).toContain("Error calling Ando MCP tool ...");
    expect(html).toContain('<pre class="markdown-code-block language-json" data-language="json"><code class="language-json">');
    expect(html).toContain('{"error":{"code":-32003}}');
    expect(html).not.toContain("```text");
    expect(html).not.toContain("```json");
  });

  test("renders fenced code blocks inside numbered list items", () => {
    const html = renderLinearMarkdown(
      "1. initialize\n2. notifications/initialized\n3. tools/call\n4. DELETE session in finally\nIf tools/call gets 400, execute wraps it as:\n```text\nError calling Ando MCP tool ...\n```\n\nThe wrapper can retry.",
    );

    expect(html).toContain('<li>DELETE session in finally<br>If tools/call gets 400, execute wraps it as:<pre class="markdown-code-block"><code>Error calling Ando MCP tool ...</code></pre></li>');
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

describe("renderInlineMarkdown", () => {
  test("renders inline code while escaping HTML", () => {
    const html = renderInlineMarkdown("Use `<apple>`.");

    expect(html).toContain("<code>&lt;apple&gt;</code>");
    expect(html).not.toContain("<apple>");
  });

  test("can leave links as plain escaped markdown", () => {
    const html = renderInlineMarkdown("See [Ando](https://app.ando.so)", { links: false });

    expect(html).toBe("See [Ando](https://app.ando.so)");
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
