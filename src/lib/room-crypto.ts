function bytesToB64(bytes: Uint8Array<ArrayBufferLike>): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function b64ToBytes(value: string): ArrayBuffer {
  const text = atob(value);
  const out = new ArrayBuffer(text.length);
  const view = new Uint8Array(out);
  for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i);
  return out;
}

export interface SeatKeys {
  publicKey: string;
  privateKey: CryptoKey;
}

export async function makeSeatKeys(): Promise<SeatKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: bytesToB64(raw), privateKey: pair.privateKey };
}

async function aesKey(mine: CryptoKey, theirPublic: string): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey("raw", b64ToBytes(theirPublic), { name: "ECDH", namedCurve: "P-256" }, true, []);
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, mine, 256);
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptHoles(mine: CryptoKey, theirPublic: string, cards: number[]): Promise<string> {
  const key = await aesKey(mine, theirPublic);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(cards))),
  );
  return `${bytesToB64(iv)}.${bytesToB64(cipher)}`;
}

export async function decryptHoles(mine: CryptoKey, theirPublic: string, payload: string): Promise<number[] | null> {
  const [ivText, cipherText] = payload.split(".");
  if (!ivText || !cipherText) return null;
  try {
    const key = await aesKey(mine, theirPublic);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(ivText) },
      key,
      b64ToBytes(cipherText),
    );
    const cards = JSON.parse(new TextDecoder().decode(plain)) as unknown;
    if (!Array.isArray(cards) || cards.some((card) => typeof card !== "number")) return null;
    return cards as number[];
  } catch {
    return null;
  }
}
