import { Skeleton } from "@/components/ui/skeleton"
import { EventsChartSkeleton } from "@/components/events-chart-skeleton"
import { TelemetryTableSkeleton } from "./telemetry-table-skeleton"

export default function Loading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b px-4 py-2 sm:flex-row sm:px-6">
        <Skeleton className="h-8 w-full sm:w-64" />
        <Skeleton className="h-8 w-full sm:w-72" />
      </div>
      <EventsChartSkeleton />
      <TelemetryTableSkeleton
        headers={["Process", "Command", "Action", "Occurrences", "Last Seen"]}
      />
    </div>
  )
}
