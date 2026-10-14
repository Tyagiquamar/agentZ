import { randomBytes, randomInt } from "node:crypto"
import { oauthDeviceAuthorization } from "@better-auth/oauth-provider"
import { getEnv } from "@/lib/env"
import { and, eq } from "drizzle-orm"
import { getDB, schema } from "@/db"

/** claudeDeviceAuthorization keeps protocol state in Better Auth's device grant. */
export function claudeDeviceAuthorization() {
  const plugin = oauthDeviceAuthorization({
    verificationUri: "/device",
    expiresIn: "10m",
    interval: "5s",
    generateDeviceCode: () => randomBytes(32).toString("base64url"),
    generateUserCode: () => {
      const alphabet = "BCDFGHJKLMNPQRSTVWXZ"
      return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("")
    },
    validateClient: async (clientId) => {
      if (!getEnv().ENABLE_CLAUDE_GATEWAY_POC || clientId !== getEnv().CLAUDE_GATEWAY_CLIENT_ID)
        return false
      const [client] = await getDB()
        .select({ id: schema.oauthClients.id })
        .from(schema.oauthClients)
        .where(
          and(eq(schema.oauthClients.clientId, clientId), eq(schema.oauthClients.disabled, false))
        )
      return !!client
    },
  })
  return {
    ...plugin,
    schema: {
      ...plugin.schema,
      deviceCode: {
        ...plugin.schema.deviceCode,
        modelName: "deviceCode",
        fields: {
          ...plugin.schema.deviceCode.fields,
          referenceId: { type: "string" as const, required: false },
          sessionId: { type: "string" as const, required: false },
        },
      },
    },
  }
}
