import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const allowedTags = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "input",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

const allowedAttributes = [
  "align",
  "alt",
  "checked",
  "class",
  "disabled",
  "href",
  "src",
  "start",
  "title",
  "type",
];

const allowedUriPattern = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;
const allowedSchemes = new Set(["http:", "https:", "mailto:", "tel:"]);

const hasAllowedScheme = (value: string): boolean => {
  const normalized = value.trim().replace(/\s/g, "");
  const scheme = normalized.match(/^([a-z][a-z\d+.-]*):/i)?.[1];
  return !scheme || allowedSchemes.has(`${scheme.toLowerCase()}:`);
};

const secureUrls = (container: HTMLElement) => {
  for (const element of container.querySelectorAll<HTMLElement>("[href], [src]")) {
    for (const attribute of ["href", "src"] as const) {
      const value = element.getAttribute(attribute);
      if (value !== null && !hasAllowedScheme(value)) {
        element.removeAttribute(attribute);
      }
    }
  }

  for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    try {
      const url = new URL(link.href, window.location.href);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin !== window.location.origin
      ) {
        link.setAttribute("rel", "noopener noreferrer");
      }
    } catch {
      link.removeAttribute("href");
    }
  }
};

const sanitizeHtml = (html: string): HTMLElement => {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_ATTR: allowedAttributes,
    ALLOWED_TAGS: allowedTags,
    ALLOWED_URI_REGEXP: allowedUriPattern,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["style"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "svg", "math"],
    RETURN_DOM_FRAGMENT: true,
  });
  const container = document.createElement("div");
  container.append(sanitized);
  secureUrls(container);
  return container;
};

const highlightText = (container: HTMLElement, term: string) => {
  const regex = new RegExp(`(${escapeRegExp(term)})`, "gi");
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();

  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const parts = textNode.data.split(regex);
    if (parts.length === 1) continue;

    const replacement = document.createDocumentFragment();
    parts.forEach((part, index) => {
      if (index % 2 === 0) {
        replacement.append(part);
        return;
      }

      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = part;
      replacement.append(mark);
    });
    textNode.replaceWith(replacement);
  }
};

type MarkdownContentProps = {
  content: string;
  className?: string;
  highlightTerm?: string;
};

export const MarkdownContent = ({ content, className, highlightTerm }: MarkdownContentProps) => {
  const html = useMemo(() => {
    const rendered = marked.parse(content, { async: false }) as string;
    const sanitized = sanitizeHtml(rendered);
    if (highlightTerm && highlightTerm.length > 0) {
      highlightText(sanitized, highlightTerm);
    }
    return sanitized.innerHTML;
  }, [content, highlightTerm]);

  // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown is strictly sanitized before controlled highlighting.
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};
