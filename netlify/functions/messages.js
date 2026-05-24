const crypto = require("crypto");
const {
  MAX_NETLIFY_FILE_SIZE,
  json,
  listMessagesForGroup,
  parseJson,
  publicMessage,
  resolveGroup,
  stores,
} = require("./shared");

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      const group = await resolveGroup(params.group, params.accessCode);
      const messages = await listMessagesForGroup(group.groupKey);
      return json(200, messages.map(publicMessage));
    }

    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

    const body = parseJson(event);
    const text = String(body.text || "").trim().slice(0, 20000);
    const file = body.file || null;
    const group = await resolveGroup(body.group, body.accessCode);

    if (!text && !file) return json(400, { error: "Message cannot be empty." });

    let fileData = null;
    if (file) {
      const buffer = Buffer.from(file.data || "", "base64");
      if (buffer.length > MAX_NETLIFY_FILE_SIZE) {
        return json(413, { error: "File is too large for Netlify. Upload a file under 4MB." });
      }

      const safeName = String(file.name || "upload.bin").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
      const fileKey = `files/${crypto.randomUUID()}-${safeName}`;
      const { files } = stores();
      await files.set(fileKey, buffer, {
        metadata: {
          fileName: safeName,
          fileType: file.type || "application/octet-stream",
          fileSize: buffer.length,
        },
      });

      fileData = {
        fileUrl: `/api/file?key=${encodeURIComponent(fileKey)}`,
        fileName: safeName,
        fileType: file.type || "application/octet-stream",
        fileSize: buffer.length,
      };
    }

    const id = crypto.randomUUID();
    const message = {
      id,
      groupName: group.displayName,
      groupKey: group.groupKey,
      username: "Anonymous",
      text,
      timestamp: Date.now(),
      ...(fileData || {}),
    };

    const { messages, backups } = stores();
    await messages.setJSON(`messages/${group.groupKey}/${message.timestamp}-${id}.json`, message);
    if (text) {
      await backups.setJSON(`text-backups/${message.timestamp}-${id}.json`, {
        id,
        groupName: group.displayName,
        timestamp: message.timestamp,
        text,
      });
    }

    return json(201, publicMessage(message));
  } catch (error) {
    return json(error.statusCode || 400, { error: error.message || "Message failed to send." });
  }
};
