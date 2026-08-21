/**
 * Which runtime are we on?
 *
 * The same probe the gjsify examples use, and no dependency: `imports` is a
 * GJS global that Node does not have. It decides whether the process needs a
 * GLib main loop to stay alive, which is the difference between a working
 * async command and one that exits before its work finishes.
 */

export function runningOnGjs(): boolean {
  return typeof (globalThis as { imports?: unknown }).imports !== 'undefined';
}

/** Version reported by `--version`, in the user agent, and to MCP clients. */
export const VERSION = '0.1.0';
