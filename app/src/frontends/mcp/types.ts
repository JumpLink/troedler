/**
 * MCP response helpers.
 *
 * One shape for success and failure alike — a single JSON text block — so a
 * client never has to guess. Errors carry the message only: the underlying
 * failures name hosts and paths, and an MCP error string ends up in a
 * transcript that outlives the request.
 */

export function mcpError(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function mcpErrorFrom(err: unknown) {
  return mcpError(err instanceof Error ? err.message : String(err));
}

export function mcpSuccess(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}
