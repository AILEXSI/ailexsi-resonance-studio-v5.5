import http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = Number(process.env.RECEIVE_PORT || 18765);
const OUT = process.env.EXPORT_OUT || "artifacts/v5-user-export.mp4";

mkdirSync("artifacts", { recursive: true });

const cssWaiters = [];
let done = false;

function releaseCss() {
  while (cssWaiters.length) {
    const res = cssWaiters.pop();
    try {
      res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
      res.end("void 0;");
    } catch {
      /* */
    }
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-export-meta");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  console.log(req.method, req.url);
  if (req.method === "GET" && (req.url === "/slow.js" || req.url?.startsWith("/slow.js") || req.url === "/slow.css" || req.url?.startsWith("/slow.css"))) {
    cssWaiters.push(res);
    req.on("close", () => {
      const i = cssWaiters.indexOf(res);
      if (i >= 0) cssWaiters.splice(i, 1);
    });
    return;
  }
  if (req.method === "POST" && req.url === "/upload") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    const meta = req.headers["x-export-meta"] || "";
    writeFileSync(OUT, buf);
    writeFileSync("artifacts/v5-user-export.meta.txt", String(meta).replace(/ \| /g, "\n"));
    console.log("received", buf.length, meta);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok " + buf.length);
    done = true;
    releaseCss();
    setTimeout(() => server.close(), 300);
    return;
  }
  if (req.method === "POST" && req.url === "/fail") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const msg = Buffer.concat(chunks).toString("utf8");
    writeFileSync("artifacts/v5-user-export.meta.txt", "FAIL\n" + msg);
    console.error("fail", msg);
    res.writeHead(200);
    res.end("ok");
    done = true;
    releaseCss();
    setTimeout(() => server.close(), 300);
    return;
  }
  res.writeHead(404);
  res.end("no");
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.listen(PORT, "127.0.0.1", () => {
  console.log("listening", PORT);
});

setTimeout(() => {
  if (!done) {
    writeFileSync("artifacts/v5-user-export.meta.txt", "FAIL\nreceiver timeout");
    console.error("receiver timeout");
    releaseCss();
    process.exit(2);
  }
}, 8 * 60 * 1000);
