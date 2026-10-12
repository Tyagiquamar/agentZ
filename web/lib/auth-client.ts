"use client"

import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { createAuthClient } from "better-auth/react"
import { twoFactorClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        const target = new URL("/signin/two-factor", window.location.href)
        target.search = window.location.search
        window.location.replace(target.href)
      },
    }),
    oauthProviderClient(),
  ],
})
