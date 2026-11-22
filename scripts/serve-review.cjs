const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..", "dist");
const port = Number(process.env.RUNJOURNEY_WEB_PORT ?? 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};
http
  .createServer((req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      return res.end();
    }
    let requested;
    try {
      requested = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400);
      return res.end();
    }
    let file = path.resolve(root, "." + requested);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    if (file === root) file = path.join(root, "index.html");
    else if (!path.extname(file)) file += ".html";
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        res.writeHead(404);
        return res.end("Build first: npm run web:build");
      }
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
    });
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`RunJourney review: http://127.0.0.1:${port} (local only)`),
  );
