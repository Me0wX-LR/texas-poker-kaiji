import { spawn } from "node:child_process";
import path from "node:path";
import { JEV_PORT, startJevProxy } from "./jev-proxy.mjs";

const proxy = startJevProxy();
proxy.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.log("Jev proxy is already running.");
    return;
  }
  console.error("Jev proxy failed to start.");
  process.exit(1);
});
proxy.listen(JEV_PORT, "127.0.0.1");

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", "-H", "0.0.0.0", "-p", "47221"], {
  stdio: "inherit",
  env: process.env,
});

function stop() {
  proxy.close();
  child.kill("SIGTERM");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  proxy.close();
  process.exit(code ?? 0);
});
