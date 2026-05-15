import DOMPurify, { type Config } from "dompurify";

export const sanitizeHTML = (html: unknown, config?: Config): string => {
  if (html === undefined || html === null) {
    return "";
  }

  const content = typeof html === "string" ? html : String(html);
  return DOMPurify.sanitize(content, config);
};
