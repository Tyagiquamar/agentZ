import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import { signInWithGithub, signInWithGoogle } from "@/app/(auth)/actions"
import { SignInForm } from "@/components/auth/sign-in-form"
import { AuthPage } from "@/components/auth/auth-page"
import { AuthorizationState } from "@/app/oauth/authorize/authorization-state"
import { getAuth } from "@/lib/auth"
import { getEnv } from "@/lib/env"
import { signInReturnTo } from "@/lib/sign-in-redirect"
import { authSearchParamsSchema, socialProviders, type SocialProvider } from "../shared"

export const metadata: Metadata = {
  title: "Sign In",
}

const providerActions = {
  github: signInWithGithub,
  google: signInWithGoogle,
} satisfies Record<SocialProvider, (formData: FormData) => Promise<never>>

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  return (
    <AuthPage>
      <SignInGate searchParams={searchParams} />
    </AuthPage>
  )
}

async function SignInGate({ searchParams }: Pick<PageProps<"/signin">, "searchParams">) {
  const requestHeaders = await headers()
  const auth = getAuth()
  const search = await searchParams
  const query = new URLSearchParams()
  for (const [key, values] of Object.entries(search)) {
    for (const value of [values].flat()) if (value !== undefined) query.append(key, value)
  }
  // Page errors may accompany a continuation but are not signed OAuth fields.
  const signedParameters = new Set([...query.getAll("ba_param"), "sig"])
  const oauthQuery = query.has("sig")
    ? new URLSearchParams([...query].filter(([key]) => signedParameters.has(key))).toString()
    : undefined
  if (oauthQuery && !(await verifyOAuthQueryParams(oauthQuery, getEnv().BETTER_AUTH_SECRET)))
    return (
      <AuthorizationState
        title="This connection request expired"
        description="Return to the app you were connecting and reattempt sign in."
      />
    )
  const params = authSearchParamsSchema.parse(search)
  const returnTo = signInReturnTo(params.returnTo)
  const session = await auth.api.getSession({
    headers: requestHeaders,
  })

  if (session && !oauthQuery) {
    redirect(returnTo ?? "/")
  }

  return (
    <SignInForm
      key={`${params.error ?? ""}:${params.provider ?? ""}:${returnTo ?? ""}`}
      actions={providerActions}
      providers={socialProviders()}
      routeError={params.error}
      routeProvider={params.provider}
      returnTo={returnTo}
      oauthQuery={oauthQuery}
      showPasswordAuth={getEnv().ENABLE_EMAIL_PASSWORD_AUTH}
    />
  )
}
