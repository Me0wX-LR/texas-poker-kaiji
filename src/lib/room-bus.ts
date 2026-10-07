import { connectMqtt, type MqttLink } from "./mqtt-ws";

export interface RoomEvent {
  id: string;
  type: "join" | "leave" | "act" | "close" | "drop" | "here" | "kick" | "refuse" | "state";
  clientId: string;
  seq?: number;
  body: unknown;
}

const BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://test.mosquitto.org:8081",
];

export interface RoomBus {
  relay: "connecting" | "relay" | "local";
  publish(event: RoomEvent, retain?: boolean): void;
  close(): void;
}

export function openRoomBus(code: string, onEvent: (event: RoomEvent) => void, onRelay: (relay: RoomBus["relay"]) => void): RoomBus {
  const seen = new Set<string>();
  const topic = `kaiji/poker/v1/${code}`;
  let relay: RoomBus["relay"] = "connecting";
  let mqtt: MqttLink | null = null;
  let closed = false;
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`kaiji-room-${code}`);

  const accept = (event: RoomEvent) => {
    if (!event || typeof event.id !== "string" || typeof event.clientId !== "string") return;
    if (seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 400) {
      const first = seen.values().next().value;
      if (first) seen.delete(first);
    }
    onEvent(event);
  };

  if (channel) {
    channel.onmessage = (message) => accept(message.data as RoomEvent);
  }

  const status: RoomBus = { relay: "connecting", publish, close };
  function setRelay(next: RoomBus["relay"]) {
    relay = next;
    status.relay = next;
    onRelay(next);
  }

  function tryBroker(index: number) {
    if (closed) return;
    const url = BROKERS[index];
    if (!url) {
      setRelay(channel ? "local" : "connecting");
      return;
    }
    mqtt = connectMqtt(url, topic, {
      onReady: () => {
        if (!closed) setRelay("relay");
      },
      onFail: () => {
        if (closed || relay === "relay") return;
        tryBroker(index + 1);
      },
      onMessage: (payload) => {
        try {
          accept(JSON.parse(payload) as RoomEvent);
        } catch {
          /* ignore a stray payload on the public topic */
        }
      },
    });
  }
  tryBroker(0);

  function publish(event: RoomEvent, retain = false) {
    if (closed) return;
    const payload = JSON.stringify(event);
    try {
      channel?.postMessage(event);
    } catch {
      /* the tab channel is already closed */
    }
    try {
      mqtt?.publish(payload, retain);
    } catch {
      /* the socket is already closed */
    }
  }

  function close() {
    closed = true;
    channel?.close();
    mqtt?.close();
  }

  return status;
}
