export { cn } from "cn"

/**
 * The words of an error, for the person. A rejection from main arrives wrapped in Electron's «Error invoking remote
 * method '…': Error: »; the words after it are already written for them.
 */
export const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (\w*Error: )?/,
    '',
  );
