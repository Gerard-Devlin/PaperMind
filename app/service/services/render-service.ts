import { promises as fsPromise } from "fs";
import katex from "katex";
import MarkdownIt from "markdown-it";
import tm from "markdown-it-texmath";
import * as mupdf from "mupdf";

import { errorcatching } from "@/base/error";
import { createDecorator } from "@/base/injection/injection";
import { eraseProtocol } from "@/base/url";

import createDOMPurify from "dompurify";

const domPurifyInstance =
  typeof (globalThis as any).window !== "undefined"
    ? createDOMPurify((globalThis as any).window)
    : null;

export const IRenderService = createDecorator("renderService");

export class RenderService {
  private _markdownIt: MarkdownIt;

  constructor() {
    this._markdownIt = new MarkdownIt({ html: true }).use(tm, {
      engine: require("katex"),
      delimiters: "dollars",
      katexOptions: { macros: { "\\RR": "\\mathbb{R}" } },
    });
  }

  /**
   * Render PDF file as PNG
   * @param fileURL - File url
   * @returns Rendered PNG buffer
   */
  async renderPDF(fileURL: string, scale = 0.5, quality = 20) {
    const doc = mupdf.Document.openDocument(
      await fsPromise.readFile(eraseProtocol(fileURL)),
      "application/pdf"
    );
    const page = doc.loadPage(0);
    const pix = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );
    const buffer = pix.asJPEG(quality, false);
    return buffer;
  }

  /**
   * Render Markdown to HTML
   * @param content - Markdown content
   * @param renderFull - Render full content or not, default is false. If false, only render first 10 lines.
   * @returns Rendered string: {renderedStr: string, overflow: boolean}
   */
  @errorcatching("Failed to render Markdown.", true, "RenderService", {
    renderedStr: "",
    overflow: false,
  })
  async renderMarkdown(content: string, renderFull = false) {
    let renderContent: string;
    let overflow: boolean;
    if (!renderFull) {
      const lines = content.split("\n");
      const renderLines = lines.slice(0, 10);
      overflow = lines.length > 10;
      renderContent = renderLines.join("\n");
    } else {
      overflow = false;
      renderContent = content;
    }
    renderContent = this._normalizeMathDelimiters(renderContent);
    const rawHtml = this._markdownIt.render(renderContent);
    const cleanHtml =
      domPurifyInstance?.sanitize(rawHtml, {
        ADD_TAGS: ["math", "semantics", "mrow", "mi", "mo", "mn", "msup", "mfrac"],
        ADD_ATTR: ["xmlns", "class"],
      }) ?? rawHtml;
    return {
      renderedStr: cleanHtml,
      overflow: overflow,
    };
  }

  private _normalizeMathDelimiters(content: string) {
    return `${content || ""}`
      .replace(
        /\$\$\s*([\s\S]*?)\s*\$\$/g,
        (_match, math) => `\n\n$$\n${math.trim()}\n$$\n\n`
      )
      .replace(
        /(^|[^\\$])\$([ \t]+)([^$\n]+?)([ \t]+)\$/g,
        (_match, prefix, _leading, math) => `${prefix}$${math.trim()}$`
      )
      .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_match, math) => `$${math.trim()}$`)
      .replace(
        /\\\[\s*([\s\S]*?)\s*\\\]/g,
        (_match, math) => `\n\n$$\n${math.trim()}\n$$\n\n`
      );
  }

  /**
   * Render Markdown file to HTML
   * @param url - File url
   * @param renderFull - Render full content or not, default is false. If false, only render first 10 lines.
   * @returns Rendered string: {renderedStr: string, overflow: boolean}
   */
  @errorcatching("Failed to render Markdown file.", true, "RenderService", {
    renderedStr: "",
    overflow: false,
  })
  async renderMarkdownFile(url: string, renderFull = false) {
    const content = await fsPromise.readFile(
      url.replace("file://", ""),
      "utf8"
    );

    return await this.renderMarkdown(content, renderFull);
  }

  /**
   * Render Math to HTML
   * @param content - Math content
   * @returns Rendered HTML string
   */
  @errorcatching("Failed to render Math.", true, "RenderService", "")
  renderMath(content: string) {
    return renderWithDelimitersToString(content);
  }
}

function renderWithDelimitersToString(text: string) {
  var CleanAndRender = function (str: string) {
    return katex.renderToString(str.replace(/\\\(|\$|\\\)/g, ""), {
      throwOnError: false,
    });
  };
  return text.replace(
    /(\\\([^]*?\\\))|(\$[^]*?\$)/g,
    function (m, bracket, dollar) {
      if (bracket !== undefined) return CleanAndRender(m);
      if (dollar !== undefined)
        return (
          "<span style='width:100%;text-align:center;'>" +
          CleanAndRender(m) +
          "</span>"
        );
      return m;
    }
  );
}
