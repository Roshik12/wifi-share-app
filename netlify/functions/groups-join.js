const { json, parseJson, resolveGroup } = require("./shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  try {
    const body = parseJson(event);
    const group = await resolveGroup(body.name, body.password);
    return json(200, { name: group.displayName });
  } catch (error) {
    return json(error.statusCode || 400, { error: error.message || "Could not join group." });
  }
};
