import { describe, expect, test } from "bun:test";
import { linearImageSource, renderInlineMarkdown, renderLinearMarkdown } from "../public/linear-markdown.js";

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
    expect(html).toContain('alt="Screenshot"');
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

  test("renders bold text", () => {
    const html = renderLinearMarkdown("Use **Recommended MVP**.");

    expect(html).toContain("Use <strong>Recommended MVP</strong>.");
    expect(html).not.toContain("**Recommended MVP**");
  });

  test("does not parse bold text inside inline code", () => {
    const html = renderLinearMarkdown("Use `**Recommended MVP**`.");

    expect(html).toContain("<code>**Recommended MVP**</code>");
    expect(html).not.toContain("<strong>Recommended MVP</strong>");
  });

  test("renders bullet and numbered lists", () => {
    const html = renderLinearMarkdown("- `apple`\n- banana\n\n1. first\n2. second");

    expect(html).toContain("<ul><li><code>apple</code></li><li>banana</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).not.toContain("- banana");
    expect(html).not.toContain("1. first");
  });

  test("keeps repeated ordered list markers numbered across nested bullets", () => {
    const html = renderLinearMarkdown("Plan:\n1. Add\n   - legacy\n   - image\n\n1. Update\n   - top\n\n1. Validate");

    expect(html).toContain(
      "Plan:<ol><li>Add<ul><li>legacy</li><li>image</li></ul></li><li>Update<ul><li>top</li></ul></li><li>Validate</li></ol>",
    );
    expect(html.match(/<ol>/g)).toHaveLength(1);
    expect(html).not.toContain("1. Update");
  });

  test("renders fenced code blocks while escaping HTML", () => {
    const html = renderLinearMarkdown("```ts\nconst apple = `<red>`;\n```");

    expect(html).toContain('<pre class="markdown-code-block" data-language="ts"><code>');
    expect(html).toContain("const apple = `&lt;red&gt;`;");
    expect(html).toContain("</code></pre>");
    expect(html).not.toContain("<red>");
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
