const crypto = require("crypto");
const { groupNameKey, hashPassword, json, parseJson, sanitizeGroup, stores } = require("./shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  try {
    const body = parseJson(event);
    const displayName = sanitizeGroup(body.name);
    const nameKey = groupNameKey(displayName);
    const password = String(body.password || "");

    if (nameKey === "main") return json(400, { error: "Main is reserved for the open room." });
    if (!password.trim()) return json(400, { error: "Private groups need a password." });

    const { groups } = stores();
    const key = `groups/${nameKey}.json`;
    if (await groups.get(key, { type: "json" })) {
      return json(409, { error: "That group name already exists." });
    }

    const group = {
      nameKey,
      displayName,
      passwordHash: hashPassword(password),
      groupKey: `private-${crypto.randomUUID()}`,
      createdAt: Date.now(),
    };

    const result = await groups.setJSON(key, group, { onlyIfNew: true });
    if (result && result.modified === false) {
      return json(409, { error: "That group name already exists." });
    }

    return json(201, { name: group.displayName });
  } catch (error) {
    return json(400, { error: error.message || "Could not create group." });
  }
};
