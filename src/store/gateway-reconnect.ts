/**
 * gateway-reconnect — 单飞重连分发器（hermes src/store/gateway-reconnect.ts 原样移植）
 *
 * 多处（liveness 探测失败 / 事件流掉线 / 手动重连）都可触发重连，
 * single-flight 保证同时只有一个重连在跑。
 */

type GatewayReconnectHandler = () => Promise<void> | void;

let activeHandler: GatewayReconnectHandler | null = null;
let inFlight: Promise<void> | null = null;

export function registerGatewayReconnect(handler: GatewayReconnectHandler): () => void {
  activeHandler = handler;

  return () => {
    if (activeHandler === handler) {
      activeHandler = null;
    }
  };
}

export function reconnectGateway(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }

  const handler = activeHandler;

  if (!handler) {
    return Promise.reject(new Error("Gateway reconnect is unavailable"));
  }

  inFlight = Promise.resolve()
    .then(handler)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
