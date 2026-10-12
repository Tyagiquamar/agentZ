import type { Metadata } from "next"
import { Suspense } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { AuthorizationState } from "@/app/oauth/authorize/authorization-state"
import { authPageParameters, getAuth } from "@/lib/auth"
import { signInReturnTo } from "@/lib/sign-in-redirect"
import { TwoFactorChallenge } from "./two-factor-challenge"

export const metadata: Metadata = {
  title: "Verify Sign In",
}

export default function TwoFactorPage({ searchParams }: PageProps<"/signin/two-factor">) {
  return (
    <Suspense fallback={<TwoFactorChallengeFallback />}>
      <TwoFactorGate searchParams={searchParams} />
    </Suspense>
  )
}

async function TwoFactorGate({
  searchParams,
}: Pick<PageProps<"/signin/two-factor">, "searchParams">) {
  const requestHeaders = await headers()
  const auth = getAuth()
  const params = await authPageParameters(await searchParams)
  const { oauthQuery } = params
  if (params.expired)
    return (
      <AuthorizationState
        title="This connection request expired"
        description="Return to the app you were connecting and reattempt sign in."
      />
    )
  const returnTo = signInReturnTo(params.returnTo) ?? "/"
  const session = await auth.api.getSession({
    headers: requestHeaders,
  })

  if (session && !oauthQuery) {
    redirect(returnTo)
  }

  return (
    <div className="flex min-h-svh w-full justify-center px-6 py-10 md:px-10 md:py-14">
      <TwoFactorChallenge returnTo={returnTo} oauth={!!oauthQuery} />
    </div>
  )
}

function TwoFactorChallengeFallback() {
  return (
    <div className="flex min-h-svh w-full justify-center px-6 py-10 md:px-10 md:py-14">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-8 pt-10">
        <div className="flex items-center justify-center gap-3">
          <div className="size-10 rounded-xl bg-muted/20" />
          <div className="h-8 w-36 rounded-md bg-muted/20" />
        </div>
        <div className="flex flex-col gap-5">
          <div className="h-9 w-full rounded-lg bg-muted/20" />
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <div className="h-4 w-24 rounded-md bg-muted/20" />
              <div className="h-8 w-full rounded-lg bg-muted/20" />
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 size-4 rounded-sm bg-muted/20" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-4 w-44 rounded-md bg-muted/20" />
                <div className="h-4 w-full rounded-md bg-muted/20" />
              </div>
            </div>
            <div className="h-9 w-full rounded-lg bg-muted/20" />
          </div>
        </div>
      </div>
    </div>
  )
}
