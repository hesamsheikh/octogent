import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "../src/components/ui/MarkdownContent";

describe("MarkdownContent", () => {
  it("removes raw script and iframe elements", () => {
    const { container } = render(
      <MarkdownContent
        content={
          'Before<script>alert("xss")</script><iframe src="https://evil.example"></iframe>After'
        }
      />,
    );

    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("iframe")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('alert("xss")');
  });

  it("removes event handlers from images", () => {
    const { container } = render(
      <MarkdownContent
        content={
          '<img src="data:image/svg+xml,%3Csvg%20onload%3Dalert(1)%3E%3C/svg%3E" onerror="alert(1)" onload="alert(2)">'
        }
      />,
    );

    const image = container.querySelector("img");
    expect(image).toBeInTheDocument();
    expect(image).not.toHaveAttribute("src");
    expect(image).not.toHaveAttribute("onerror");
    expect(image).not.toHaveAttribute("onload");
  });

  it("removes SVG payloads and their event handlers", () => {
    const { container } = render(
      <MarkdownContent content={'<svg onload="alert(1)"><circle cx="10" cy="10" r="5" /></svg>'} />,
    );

    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(container.querySelector("[onload]")).not.toBeInTheDocument();
  });

  it("removes encoded javascript links after highlighting", () => {
    const { container } = render(
      <MarkdownContent content={'[unsafe](jav&#x61;script:alert("xss"))'} highlightTerm="unsafe" />,
    );

    const link = container.querySelector("a");
    expect(link).toBeInTheDocument();
    expect(link).not.toHaveAttribute("href");
    expect(link?.querySelector("mark.search-highlight")).toHaveTextContent("unsafe");
    expect(container.innerHTML.toLowerCase()).not.toContain("javascript:");
  });

  it("preserves normal Markdown rendering and secures external links", () => {
    const { container } = render(
      <MarkdownContent
        content={
          "# Heading\n\n- first\n- second\n\n```ts\nconst answer = 42;\n```\n\n[Octogent](https://octogent.example/docs)"
        }
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Heading" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("code.language-ts")).toHaveTextContent("const answer = 42;");
    expect(screen.getByRole("link", { name: "Octogent" })).toHaveAttribute(
      "href",
      "https://octogent.example/docs",
    );
    expect(screen.getByRole("link", { name: "Octogent" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });
});
