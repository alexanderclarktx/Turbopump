export function renderLinearMarkdown(
  value: unknown,
  fallback?: string,
  options?: {
    images?: boolean;
    links?: boolean;
  },
): string;

export function renderInlineMarkdown(
  value: unknown,
  options?: {
    images?: boolean;
    links?: boolean;
  },
): string;

export function linearImageSource(url: unknown): string;
