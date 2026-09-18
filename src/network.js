// Thin WebSocket client wrapper with an event-emitter style API.
export function connect(name, handlers) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "join", name }));
  });

  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const fn = handlers[msg.type];
    if (fn) fn(msg);
  });

  ws.addEventListener("close", () => {
    if (handlers.__close) handlers.__close();
  });

  function sendMsg(type, payload = {}) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
  }

  return { ws, send: sendMsg };
}
