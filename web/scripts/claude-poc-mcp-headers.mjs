import { readFileSync } from "node:fs"
import { join } from "node:path"

// Claude's native gateway login owns token storage and refresh. MCP's
// headersHelper reads that credential without putting a token in .mcp.json.
const directory = process.env.CLAUDE_CONFIG_DIR
if (!directory) throw new Error("Set CLAUDE_CONFIG_DIR to the isolated PoC profile.")
const { enterpriseGateway } = JSON.parse(readFileSync(join(directory, ".credentials.json"), "utf8"))
if (!enterpriseGateway?.jwt || enterpriseGateway.expiresAt <= Date.now())
  throw new Error("Sign in to the AgentZ gateway with /login before connecting MCP.")
process.stdout.write(JSON.stringify({ Authorization: `Bearer ${enterpriseGateway.jwt}` }))
