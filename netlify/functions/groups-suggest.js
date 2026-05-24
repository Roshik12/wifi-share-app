const { groupNameKey, json, randomGroupName, stores } = require("./shared");

exports.handler = async () => {
  const { groups } = stores();
  let name = randomGroupName();

  while (await groups.get(`groups/${groupNameKey(name)}.json`, { type: "json" })) {
    name = randomGroupName();
  }

  return json(200, { name });
};
