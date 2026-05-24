const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const uploadsDir = path.join(rootDir, "uploads");
const dataDir = path.join(rootDir, "server", "data");
const jsonDbPath = path.join(dataDir, "messages.dev.json");
const groupsDbPath = path.join(dataDir, "groups.dev.json");
const textBackupPath = path.join(dataDir, "text-backup.jsonl");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const REQUEST_LIMIT = 6 * 1024 * 1024;
const MESSAGE_TTL_MS = 28 * 60 * 60 * 1000;
const clients = new Set();

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".zip": "application/zip",
};

const socketShim = `
(function () {
  window.io = function (options) {
    const handlers = {};
    let source;
    const group = options && options.query && options.query.group ? options.query.group : 'main';
    const accessCode = options && options.query && options.query.accessCode ? options.query.accessCode : '';
    const api = {
      on(event, callback) {
        handlers[event] = handlers[event] || [];
        handlers[event].push(callback);
        return api;
      },
      disconnect() {
        if (source) source.close();
      }
    };
    function emit(event, payload) {
      (handlers[event] || []).forEach((callback) => callback(payload));
    }
    setTimeout(function () {
      source = new EventSource(
        '/events?group=' + encodeURIComponent(group) + '&accessCode=' + encodeURIComponent(accessCode)
      );
      source.onopen = function () { emit('connect'); };
      source.onerror = function () { emit('disconnect'); };
      source.addEventListener('messages:init', function (event) {
        emit('messages:init', JSON.parse(event.data));
      });
      source.addEventListener('message:new', function (event) {
        emit('message:new', JSON.parse(event.data));
      });
    }, 0);
    return api;
  };
}());
`;

function readMessages() {
  try {
    return JSON.parse(fs.readFileSync(jsonDbPath, "utf8"));
  } catch {
    return [];
  }
}

function readGroups() {
  try {
    return JSON.parse(fs.readFileSync(groupsDbPath, "utf8"));
  } catch {
    return [];
  }
}

function writeMessages(messages) {
  fs.writeFileSync(jsonDbPath, JSON.stringify(messages, null, 2));
}

function writeGroups(groups) {
  fs.writeFileSync(groupsDbPath, JSON.stringify(groups, null, 2));
}

function backupTextMessage(message) {
  if (!message.text) return;

  const backup = {
    id: message.id,
    groupName: message.groupName,
    timestamp: message.timestamp,
    text: message.text,
  };

  fs.appendFile(textBackupPath, `${JSON.stringify(backup)}\n`, (error) => {
    if (error) console.error("Could not write text backup:", error.message);
  });
}

function publicMessage(message) {
  return {
    id: message.id,
    groupName: message.groupName || "main",
    username: message.username,
    text: message.text || "",
    timestamp: message.timestamp,
    fileUrl: message.fileUrl || null,
    fileName: message.fileName || null,
    fileType: message.fileType || null,
    fileSize: message.fileSize || null,
  };
}

function cleanupExpiredMessages() {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  const messages = readMessages();
  const active = [];

  messages.forEach((message) => {
    if (message.timestamp >= cutoff) {
      active.push(message);
      return;
    }

    if (message.filePath) {
      const absolutePath = path.resolve(message.filePath);
      const safeUploadsDir = `${path.resolve(uploadsDir)}${path.sep}`;
      if (absolutePath.startsWith(safeUploadsDir)) {
        fs.rm(absolutePath, { force: true }, () => {});
      }
    }
  });

  if (active.length !== messages.length) {
    writeMessages(active);
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sanitizeGroup(group) {
  const value = String(group || "main").trim().replace(/\s+/g, " ").slice(0, 40);
  return value || "main";
}

function groupNameKey(group) {
  return sanitizeGroup(group).toLowerCase();
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function randomGroupName() {
  const left = ["atlas", "pixel", "campus", "signal", "nova", "orbit", "cedar", "mint"];
  const right = ["room", "lab", "circle", "desk", "hub", "note", "share", "space"];
  return `${left[Math.floor(Math.random() * left.length)]}-${right[Math.floor(Math.random() * right.length)]}-${crypto.randomInt(100, 999)}`;
}

function resolveGroup(group, password) {
  const displayName = sanitizeGroup(group);
  const nameKey = groupNameKey(displayName);
  const passwordValue = String(password || "");

  if (nameKey === "main") {
    return { displayName: "Main", groupKey: "open:main" };
  }

  const existing = readGroups().find((item) => item.nameKey === nameKey);
  if (!existing) {
    const error = new Error("Group not found. Create it first or check the name.");
    error.status = 404;
    throw error;
  }

  if (!passwordValue || hashPassword(passwordValue) !== existing.passwordHash) {
    const error = new Error("Group password does not match.");
    error.status = 403;
    throw error;
  }

  return { displayName: existing.displayName, groupKey: existing.groupKey };
}

function sendFile(res, filePath, options = {}) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const headers = {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    };
    if (options.upload) {
      headers["X-Content-Type-Options"] = "nosniff";
    }
    if (options.upload && !isPreviewableImagePath(filePath)) {
      headers["Content-Type"] = "application/octet-stream";
      headers["Content-Disposition"] = `attachment; filename="${path.basename(filePath)}"`;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function isPreviewableImagePath(filePath) {
  return [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(path.extname(filePath).toLowerCase());
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > REQUEST_LIMIT) {
        reject(new Error("Request is too large. Images must be under 5MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function collectJson(req) {
  const body = await collectBody(req);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("Missing multipart boundary.");

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const fields = {};
  let file = null;
  let cursor = 0;

  while (cursor < buffer.length) {
    const boundaryStart = buffer.indexOf(boundary, cursor);
    if (boundaryStart === -1) break;

    let partStart = boundaryStart + boundary.length;
    if (buffer[partStart] === 45 && buffer[partStart + 1] === 45) break;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;

    const nextBoundary = buffer.indexOf(boundary, partStart);
    if (nextBoundary === -1) break;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd === -1 || headerEnd > nextBoundary) break;

    const headerText = buffer.subarray(partStart, headerEnd).toString("utf8");
    let body = buffer.subarray(headerEnd + 4, nextBoundary);
    if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) {
      body = body.subarray(0, body.length - 2);
    }

    const name = /name="([^"]+)"/.exec(headerText)?.[1];
    const originalName = /filename="([^"]*)"/.exec(headerText)?.[1];
    const fileType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1];

    if (name && originalName) {
      if (body.length > MAX_FILE_SIZE) {
        throw new Error("File is too large. Please upload a file under 5MB.");
      }

      const ext = path.extname(originalName).toLowerCase();
      const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, body);
      file = {
        fileName: originalName,
        fileType: fileType || "application/octet-stream",
        fileSize: body.length,
        filePath,
        fileUrl: `/uploads/${filename}`,
      };
    } else if (name) {
      fields[name] = body.toString("utf8");
    }

    cursor = nextBoundary;
  }

  return { fields, file };
}

function broadcast(groupName, event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((client) => {
    if (client.groupName === groupName) {
      client.res.write(data);
    }
  });
}

function getLocalAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

async function handlePostMessage(req, res) {
  try {
    const body = await collectBody(req);
    const { fields, file } = parseMultipart(body, req.headers["content-type"]);
    const text = String(fields.text || "").trim().slice(0, 20000);
    const group = resolveGroup(fields.group, fields.accessCode);

    if (!text && !file) {
      sendJson(res, 400, { error: "Message cannot be empty." });
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      groupName: group.displayName,
      groupKey: group.groupKey,
      username: "Anonymous",
      text,
      timestamp: Date.now(),
      ...(file || {}),
    };

    const messages = readMessages();
    messages.push(message);
    writeMessages(messages);
    backupTextMessage(message);

    const payload = publicMessage(message);
    broadcast(group.groupKey, "message:new", payload);
    sendJson(res, 201, payload);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Message failed to send." });
  }
}

async function handleCreateGroup(req, res) {
  try {
    const body = await collectJson(req);
    const displayName = sanitizeGroup(body.name);
    const nameKey = groupNameKey(displayName);
    const password = String(body.password || "");
    const groups = readGroups();

    if (nameKey === "main") {
      sendJson(res, 400, { error: "Main is reserved for the open room." });
      return;
    }
    if (!password.trim()) {
      sendJson(res, 400, { error: "Private groups need a password." });
      return;
    }
    if (groups.some((group) => group.nameKey === nameKey)) {
      sendJson(res, 409, { error: "That group name already exists." });
      return;
    }

    const group = {
      nameKey,
      displayName,
      passwordHash: hashPassword(password),
      groupKey: `private:${crypto.randomUUID()}`,
      createdAt: Date.now(),
    };
    groups.push(group);
    writeGroups(groups);
    sendJson(res, 201, { name: group.displayName });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not create group." });
  }
}

async function handleJoinGroup(req, res) {
  try {
    const body = await collectJson(req);
    const group = resolveGroup(body.name, body.password);
    sendJson(res, 200, { name: group.displayName });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message || "Could not join group." });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/events") {
    let group;
    try {
      group = resolveGroup(url.searchParams.get("group"), url.searchParams.get("accessCode"));
    } catch (error) {
      sendJson(res, error.status || 400, { error: error.message || "Unable to join group." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const client = { groupName: group.groupKey, res };
    clients.add(client);
    const messages = readMessages()
      .filter((message) => (message.groupKey || `open:${(message.groupName || "main").toLowerCase()}`) === group.groupKey)
      .map(publicMessage);
    res.write(`event: messages:init\ndata: ${JSON.stringify(messages)}\n\n`);
    req.on("close", () => clients.delete(client));
    return;
  }

  if (req.method === "GET" && url.pathname === "/socket.io/socket.io.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    res.end(socketShim);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/messages") {
    let group;
    try {
      group = resolveGroup(url.searchParams.get("group"), url.searchParams.get("accessCode"));
    } catch (error) {
      sendJson(res, error.status || 400, { error: error.message || "Unable to join group." });
      return;
    }
    const messages = readMessages()
      .filter((message) => (message.groupKey || `open:${(message.groupName || "main").toLowerCase()}`) === group.groupKey)
      .map(publicMessage);
    sendJson(res, 200, messages);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/groups/suggest") {
    let name = randomGroupName();
    const groups = readGroups();
    while (groups.some((group) => group.nameKey === groupNameKey(name))) {
      name = randomGroupName();
    }
    sendJson(res, 200, { name });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/groups") {
    handleCreateGroup(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/groups/join") {
    handleJoinGroup(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    handlePostMessage(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
    const filePath = path.resolve(rootDir, `.${decodeURIComponent(url.pathname)}`);
    const safeUploadsDir = `${path.resolve(uploadsDir)}${path.sep}`;
    if (!filePath.startsWith(safeUploadsDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    sendFile(res, filePath, { upload: true });
    return;
  }

  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(publicDir, `.${requestPath}`);
  const safePublicDir = `${path.resolve(publicDir)}${path.sep}`;

  if (!filePath.startsWith(safePublicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  sendFile(res, filePath);
});

cleanupExpiredMessages();
setInterval(cleanupExpiredMessages, 60 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`Local server: http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") {
    getLocalAddresses().forEach((address) => {
      console.log(`WiFi access:  http://${address}:${PORT}`);
    });
  } else {
    console.log("WiFi access is off in localhost-only mode.");
  }
  console.log("Using dependency-free fallback server because npm is not available.");
});
