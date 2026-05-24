const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { Server } = require("socket.io");
const {
  dbPath,
  insertGroup,
  findGroup,
  insertMessage,
  listMessages,
  expiredMessages,
  deleteExpired,
} = require("./database");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 7 * 1024 * 1024,
});

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, "server", "data");
const uploadsDir = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(rootDir, "uploads");
const textBackupPath = path.join(dataDir, "text-backup.jsonl");
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MESSAGE_TTL_MS = 28 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));
app.use(
  "/uploads",
  express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (!isPreviewableImagePath(filePath)) {
        res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
        res.setHeader("Content-Type", "application/octet-stream");
      }
    },
  }),
);

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
});

function isPreviewableImagePath(filePath) {
  return [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(path.extname(filePath).toLowerCase());
}

function sanitizeText(text) {
  const value = String(text || "").trim();
  return value.slice(0, 20000);
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

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function resolveGroup(group, password) {
  const displayName = sanitizeGroup(group);
  const nameKey = groupNameKey(displayName);
  const passwordValue = String(password || "");

  if (nameKey === "main") {
    return { displayName: "Main", groupKey: "open:main" };
  }

  const existing = findGroup.get(nameKey);
  if (!existing) {
    throw createHttpError(404, "Group not found. Create it first or check the name.");
  }

  if (!passwordValue || hashPassword(passwordValue) !== existing.passwordHash) {
    throw createHttpError(403, "Group password does not match.");
  }

  return { displayName: existing.displayName, groupKey: existing.groupKey };
}

function messageFromRow(row) {
  return {
    id: row.id,
    groupName: row.groupName || "main",
    username: row.username,
    text: row.text || "",
    timestamp: row.timestamp,
    fileUrl: row.fileUrl || null,
    fileName: row.fileName || null,
    fileType: row.fileType || null,
    fileSize: row.fileSize || null,
  };
}

function createMessage({ group, accessCode, text, file }) {
  const cleanText = sanitizeText(text);
  if (!cleanText && !file) {
    const error = new Error("Message cannot be empty.");
    error.status = 400;
    throw error;
  }

  const groupInfo = resolveGroup(group, accessCode);
  const fileUrl = file ? `/uploads/${file.filename}` : null;
  const filePath = file ? file.path : null;
  const message = {
    id: crypto.randomUUID(),
    groupName: groupInfo.displayName,
    groupKey: groupInfo.groupKey,
    username: "Anonymous",
    text: cleanText,
    timestamp: Date.now(),
    fileUrl,
    filePath,
    fileName: file ? file.originalname : null,
    fileType: file ? file.mimetype : null,
    fileSize: file ? file.size : null,
  };

  insertMessage.run(message);
  backupTextMessage(message);
  return {
    payload: messageFromRow(message),
    groupKey: message.groupKey,
  };
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

function getLocalAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  Object.values(interfaces).forEach((entries = []) => {
    entries.forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    });
  });

  return addresses;
}

function cleanupExpiredMessages() {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  const expired = expiredMessages.all(cutoff);

  expired.forEach((message) => {
    if (!message.filePath) return;
    const absolutePath = path.resolve(message.filePath);
    const safeUploadsDir = `${path.resolve(uploadsDir)}${path.sep}`;
    if (!absolutePath.startsWith(safeUploadsDir)) return;
    fs.rm(absolutePath, { force: true }, () => {});
  });

  if (expired.length > 0) {
    deleteExpired.run(cutoff);
    console.log(`Deleted ${expired.length} expired message(s).`);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    database: dbPath,
    textBackup: textBackupPath,
    expiresAfterHours: 28,
    maxFileSizeMb: 5,
  });
});

app.get("/api/groups/suggest", (_req, res) => {
  let name = randomGroupName();
  while (findGroup.get(groupNameKey(name))) {
    name = randomGroupName();
  }
  res.json({ name });
});

app.post("/api/groups", (req, res, next) => {
  try {
    const displayName = sanitizeGroup(req.body.name);
    const nameKey = groupNameKey(displayName);
    const password = String(req.body.password || "");

    if (nameKey === "main") {
      throw createHttpError(400, "Main is reserved for the open room.");
    }
    if (!password.trim()) {
      throw createHttpError(400, "Private groups need a password.");
    }
    if (findGroup.get(nameKey)) {
      throw createHttpError(409, "That group name already exists.");
    }

    const group = {
      nameKey,
      displayName,
      passwordHash: hashPassword(password),
      groupKey: `private:${crypto.randomUUID()}`,
      createdAt: Date.now(),
    };
    insertGroup.run(group);
    res.status(201).json({ name: group.displayName });
  } catch (error) {
    next(error);
  }
});

app.post("/api/groups/join", (req, res, next) => {
  try {
    const group = resolveGroup(req.body.name, req.body.password);
    res.json({ name: group.displayName });
  } catch (error) {
    next(error);
  }
});

app.get("/api/messages", (req, res) => {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  const group = resolveGroup(req.query.group, req.query.accessCode);
  const messages = listMessages
    .all(cutoff, group.groupKey)
    .map(messageFromRow);
  res.json(messages);
});

app.post("/api/messages", upload.single("file"), (req, res, next) => {
  try {
    const created = createMessage({
      group: req.body.group,
      accessCode: req.body.accessCode,
      text: req.body.text,
      file: req.file,
    });

    io.to(created.groupKey).emit("message:new", created.payload);
    res.status(201).json(created.payload);
  } catch (error) {
    if (req.file) {
      fs.rm(req.file.path, { force: true }, () => {});
    }
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || (error.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  const message =
    error.code === "LIMIT_FILE_SIZE"
      ? "File is too large. Please upload a file under 5MB."
      : error.message || "Something went wrong.";

  res.status(status).json({ error: message });
});

io.on("connection", (socket) => {
  try {
    const group = resolveGroup(socket.handshake.query.group, socket.handshake.query.accessCode);
    socket.join(group.groupKey);
    socket.emit(
      "messages:init",
      listMessages.all(Date.now() - MESSAGE_TTL_MS, group.groupKey).map(messageFromRow),
    );
  } catch (error) {
    socket.emit("group:error", error.message || "Unable to join group.");
    socket.disconnect(true);
  }
});

cleanupExpiredMessages();
setInterval(cleanupExpiredMessages, CLEANUP_INTERVAL_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Local server: http://localhost:${PORT}`);
  getLocalAddresses().forEach((address) => {
    console.log(`WiFi access:  http://${address}:${PORT}`);
  });
  console.log(`Database:     ${dbPath}`);
});
