"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent shadow-inner transition-[background-color,border-color,box-shadow,opacity] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)] outline-none after:absolute after:-inset-x-2 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-7 data-[size=default]:w-11 data-[size=sm]:h-5.5 data-[size=sm]:w-9 data-checked:bg-primary data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-surface shadow-ds-control ring-0 transition-transform duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)] group-data-[size=default]/switch:size-6 group-data-[size=sm]/switch:size-4.5 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3.5 group-data-[size=default]/switch:data-unchecked:translate-x-0.5 group-data-[size=sm]/switch:data-unchecked:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
