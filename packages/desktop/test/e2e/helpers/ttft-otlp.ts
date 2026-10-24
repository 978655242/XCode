export function readTtftReceiverOrigin(): string {
  const configured = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  // XCODE: TTFT 仅向本轮独占的原 loopback receiver 取样，不继承真实或其他会话的 exporter。
  if (!configured || !URL.canParse(configured)) {
    throw new Error("TTFT requires a configured loopback OTLP receiver endpoint");
  }
  const endpoint = new URL(configured);
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("TTFT requires an owned http://127.0.0.1:<port> OTLP receiver origin");
  }
  return endpoint.origin;
}
