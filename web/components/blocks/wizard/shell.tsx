"use client"

import { WizardPanel, WizardStepNav, type WizardStep } from "@/components/interior/wizard-steps"
import type { ReactNode } from "react"
import { Separator } from "@/components/ui/separator"

export function WizardShell<TStep extends WizardStep>({
  canVisitStepAction,
  children,
  currentIndex,
  currentStepId,
  direction,
  onStepSelectAction,
  steps,
}: {
  steps: readonly TStep[]
  currentIndex: number
  currentStepId: TStep["id"]
  direction: number
  children: ReactNode
  canVisitStepAction: (step: TStep, index: number) => boolean
  onStepSelectAction: (step: TStep, index: number) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center">
      <div className="flex w-full justify-start px-4 sm:justify-center sm:px-6">
        <WizardStepNav
          canVisitStepAction={canVisitStepAction}
          currentIndex={currentIndex}
          onStepSelectAction={onStepSelectAction}
          steps={steps}
        />
      </div>
      <Separator className="my-6" />
      <WizardPanel direction={direction} stepKey={currentStepId}>
        <div
          id={`wizard-panel-${currentStepId}`}
          role="tabpanel"
          aria-labelledby={`wizard-step-${currentStepId}`}
          tabIndex={0}
          className="min-h-0 w-full min-w-0"
        >
          {children}
        </div>
      </WizardPanel>
    </div>
  )
}
