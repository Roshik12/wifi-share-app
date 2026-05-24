const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const MESSAGE_TTL_MS = 28 * 60 * 60 * 1000;
const MAX_NETLIFY_FILE_SIZE = 4 * 1024 * 1024;

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
}

function parseJson(event) {
  if (!event.body) return {};
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(body || "{}");
}

function sanitizeText(text) {
  return String(text || "").trim().slice(0, 20000);
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

function stores() {
  return {
    groups: getStore("wifi-share-groups"),
    messages: getStore("wifi-share-messages"),
    files: getStore("wifi-share-files"),
    backups: getStore("wifi-share-text-backups"),
  };
}

async function resolveGroup(group, password) {
  const displayName = sanitizeGroup(group);
  const nameKey = groupNameKey(displayName);
  const passwordValue = String(password || "");

  if (nameKey === "main") {
    return { displayName: "Main", groupKey: "open-main" };
  }

  const { groups } = stores();
  const existing = await groups.get(`groups/${nameKey}.json`, { type: "json" });
  if (!existing) {
    const error = new Error("Group not found. Create it first or check the name.");
    error.statusCode = 404;
    throw error;
  }

  if (!passwordValue || hashPassword(passwordValue) !== existing.passwordHash) {
    const error = new Error("Group password does not match.");
    error.statusCode = 403;
    throw error;
  }

  return { displayName: existing.displayName, groupKey: existing.groupKey };
}

async function listMessagesForGroup(groupKey) {
  const { messages } = stores();
  const prefix = `messages/${groupKey}/`;
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  const listed = await messages.list({ prefix });
  const result = [];

  await Promise.all(
    listed.blobs.map(async (entry) => {
      const message = await messages.get(entry.key, { type: "json" });
      if (!message) return;
      if (message.timestamp < cutoff) {
        await messages.delete(entry.key);
        return;
      }
      result.push(message);
    }),
  );

  return result.sort((a, b) => a.timestamp - b.timestamp);
}

function publicMessage(message) {
  return {
    id: message.id,
    groupName: message.groupName,
    username: "Anonymous",
    text: message.text || "",
    timestamp: message.timestamp,
    fileUrl: message.fileUrl || null,
    fileName: message.fileName || null,
    fileType: message.fileType || null,
    fileSize: message.fileSize || null,
  };
}

module.exports = {
  MAX_NETLIFY_FILE_SIZE,
  hashPassword,
  json,
  listMessagesForGroup,
  parseJson,
  publicMessage,
  randomGroupName,
  resolveGroup,
  sanitizeGroup,
  groupNameKey,
  stores,
};
