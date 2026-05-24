const { json, stores } = require("./shared");

exports.handler = async (event) => {
  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (!key || !key.startsWith("files/")) return json(400, { error: "Missing file key." });

  const { files } = stores();
  const entry = await files.getWithMetadata(key, { type: "arrayBuffer" });
  if (!entry || !entry.data) return json(404, { error: "File not found." });

  const metadata = entry.metadata || {};
  const fileType = metadata.fileType || "application/octet-stream";
  const fileName = metadata.fileName || "download";
  const isImage = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(fileType);

  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      "Content-Type": isImage ? fileType : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": isImage ? "inline" : `attachment; filename="${fileName}"`,
    },
    body: Buffer.from(entry.data).toString("base64"),
  };
};
