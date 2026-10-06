import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Texas Poker Kaiji",
    short_name: "Kaiji",
    description: "Six-max Hold'em you can play on a phone. Kaiji's static chart against a field of bots.",
    start_url: ".",
    display: "standalone",
    background_color: "#140e0b",
    theme_color: "#140e0b",
    icons: [{ src: "icon.png", sizes: "192x192", type: "image/png", purpose: "any" }],
  };
}
