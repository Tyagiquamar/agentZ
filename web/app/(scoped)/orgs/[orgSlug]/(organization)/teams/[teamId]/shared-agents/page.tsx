import { RememberRoute } from "@/data/route-memory"
import { AdministrationState } from "@/components/administration"

export const metadata = { title: "Shared agents" }

export default function SharedAgentsPage() {
  return (
    <>
      <RememberRoute />
      <AdministrationState description="" kind="empty" title="No shared Agents" />
    </>
  )
}
