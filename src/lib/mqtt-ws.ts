/** Tiny MQTT 3.1.1 client over a browser WebSocket. QoS 0, enough for full-state snapshots. */

type Packet = { type: number; body: Uint8Array };

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const part of parts) n += part.length;
  const out = new Uint8Array(n);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 255, value & 255]);
}

function mqttString(value: string): Uint8Array {
  const body = new TextEncoder().encode(value);
  return concat([u16(body.length), body]);
}

function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    let digit = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) digit |= 128;
    out.push(digit);
  } while (rest > 0);
  return out;
}

function frame(type: number, body: Uint8Array): Uint8Array {
  return concat([new Uint8Array([type, ...varint(body.length)]), body]);
}

function readPackets(buffer: Uint8Array): { packets: Packet[]; rest: Uint8Array } {
  const packets: Packet[] = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const type = buffer[offset];
    let multiplier = 1;
    let length = 0;
    let cursor = offset + 1;
    let done = false;
    for (let i = 0; i < 4 && cursor < buffer.length; i++) {
      const digit = buffer[cursor];
      cursor += 1;
      length += (digit & 127) * multiplier;
      multiplier *= 128;
      if ((digit & 128) === 0) {
        done = true;
        break;
      }
    }
    if (!done || buffer.length - cursor < length) break;
    packets.push({ type, body: buffer.slice(cursor, cursor + length) });
    offset = cursor + length;
  }
  return { packets, rest: buffer.slice(offset) };
}

function publishPacket(topic: string, payload: string, retain: boolean): Uint8Array {
  return frame(retain ? 0x31 : 0x30, concat([mqttString(topic), new TextEncoder().encode(payload)]));
}

export interface MqttLink {
  publish(payload: string, retain?: boolean): void;
  close(): void;
}

export function connectMqtt(
  url: string,
  topic: string,
  handlers: {
    onMessage: (payload: string) => void;
    onReady: () => void;
    onFail: (reason: string) => void;
  },
): MqttLink {
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch (cause) {
    handlers.onFail(cause instanceof Error ? cause.message : "The relay refused the socket.");
    return { publish() {}, close() {} };
  }
  socket.binaryType = "arraybuffer";
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let ready = false;
  let dead = false;
  const clientId = `k${Math.random().toString(16).slice(2, 10)}`;
  const fail = (reason: string) => {
    if (dead) return;
    dead = true;
    handlers.onFail(reason);
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  };
  const timer = setTimeout(() => fail("The room relay did not answer."), 6000);
  const ping = setInterval(() => {
    if (ready && socket.readyState === WebSocket.OPEN) socket.send(new Uint8Array([0xc0, 0x00]));
  }, 20000);

  socket.onopen = () => {
    const body = concat([
      mqttString("MQTT"),
      new Uint8Array([4, 0x02, 0x00, 30]),
      mqttString(clientId),
    ]);
    socket.send(frame(0x10, body));
  };
  socket.onerror = () => fail("The room relay could not be reached.");
  socket.onclose = () => {
    if (!ready) fail("The room relay closed.");
  };
  socket.onmessage = (event) => {
    const chunk = new Uint8Array(event.data as ArrayBuffer);
    buffer = concat([buffer, chunk]);
    const parsed = readPackets(buffer);
    buffer = parsed.rest;
    for (const packet of parsed.packets) {
      const kind = packet.type >> 4;
      if (kind === 2) {
        const code = packet.body[1] ?? 1;
        if (code !== 0) {
          fail("The room relay refused the connection.");
          return;
        }
        socket.send(frame(0x82, concat([u16(1), mqttString(topic), new Uint8Array([0])])));
      } else if (kind === 9) {
        if (!ready) {
          ready = true;
          clearTimeout(timer);
          handlers.onReady();
        }
      } else if (kind === 3) {
        const topicLen = ((packet.body[0] ?? 0) << 8) | (packet.body[1] ?? 0);
        const payload = new TextDecoder().decode(packet.body.slice(2 + topicLen));
        handlers.onMessage(payload);
      }
    }
  };

  return {
    publish(payload: string, retain = false) {
      if (!ready || socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(publishPacket(topic, payload, retain));
      } catch {
        /* the socket closed between the check and the send */
      }
    },
    close() {
      dead = true;
      clearTimeout(timer);
      clearInterval(ping);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    },
  };
}
