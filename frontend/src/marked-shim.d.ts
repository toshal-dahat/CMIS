/** Minimal typings when package types are not resolved by the checker. */
declare module 'marked' {
  interface MarkedStatic {
    (src: string, options?: unknown): string;
    parse(src: string, options?: unknown): string;
  }
  export const marked: MarkedStatic;
}
