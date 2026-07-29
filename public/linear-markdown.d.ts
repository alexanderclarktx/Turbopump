export function renderLinearMarkdown(
  value: unknown,
  fallback?: string,
  options?: {
    images?: boolean;
    links?: boolean;
    compactBlankLines?: boolean;
    copyCode?: boolean;
    imageSource?: (url: string) => string;
  },
): string;

export function renderInlineMarkdown(
  value: unknown,
  options?: {
    images?: boolean;
    links?: boolean;
    imageSource?: (url: string) => string;
  },
): string;

export function renderTextWithSentenceBreaks(value: unknown): string;

export function linearImageSource(url: unknown): string;
