const { json, stores } = require("./shared");

exports.handler = async (event) => {
  const token = event.queryStringParameters && event.queryStringParameters.token;
  const expected = process.env.ADMIN_BACKUP_TOKEN;

  if (!expected) return json(403, { error: "ADMIN_BACKUP_TOKEN is not configured." });
  if (token !== expected) return json(403, { error: "Forbidden." });

  const { backups } = stores();
  const listed = await backups.list({ prefix: "text-backups/" });
  const rows = [];

  await Promise.all(
    listed.blobs.map(async (entry) => {
      const backup = await backups.get(entry.key, { type: "json" });
      if (backup) rows.push(backup);
    }),
  );

  rows.sort((a, b) => a.timestamp - b.timestamp);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"text-backup.jsonl\"",
    },
    body: rows.map((row) => JSON.stringify(row)).join("\n"),
  };
};
