"use client";

import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { motionTransitions } from "@/lib/motion";

export default function InterfaceProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={motionTransitions.default}>
      <LazyMotion features={domAnimation} strict>
        <TooltipProvider delayDuration={450}>{children}</TooltipProvider>
      </LazyMotion>
    </MotionConfig>
  );
}
