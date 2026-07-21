import "dotenv/config";
import { commandDefinitions } from "./commands/definitions";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");

const response = await fetch(`https://discord.com/api/v10/applications/${clientId}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
  body: JSON.stringify(commandDefinitions),
});
if (!response.ok) throw new Error(`Discord command deployment failed (${response.status}): ${await response.text()}`);
console.log(`Deployed ${commandDefinitions.length} application commands.`);
