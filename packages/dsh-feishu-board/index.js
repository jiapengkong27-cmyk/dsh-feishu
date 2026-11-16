/**
 * dsh-feishu-board — Host half.
 *
 * The page, the sidebar entry and the header indicator live in the Client half.
 * Connection state and every action (check, repair, test send, disconnect,
 * reconnect) come from `dsh-feishu-observer`'s local `/feishu-observer/*` API, so
 * this half keeps no state of its own: two owners of the same bridge would only
 * drift apart.
 */
export function apply(ctx) {
  ctx.logger?.info?.('dsh-feishu-board: sidebar entry, header indicator and board mounted (state via /feishu-observer)')
}