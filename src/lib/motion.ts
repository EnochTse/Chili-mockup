import type { Transition, Variants } from "motion/react";

export const motionEasing = {
  standard: [0.2, 0, 0, 1] as const,
  emphasized: [0.16, 1, 0.3, 1] as const
};

export const motionTransitions = {
  feedback: {
    duration: 0.14,
    ease: motionEasing.standard
  } satisfies Transition,
  default: {
    duration: 0.22,
    ease: motionEasing.standard
  } satisfies Transition,
  panel: {
    duration: 0.32,
    ease: motionEasing.emphasized
  } satisfies Transition,
  spring: {
    type: "spring",
    stiffness: 380,
    damping: 34,
    mass: 0.78
  } satisfies Transition
};

export const pageRevealVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: motionTransitions.panel
  }
} satisfies Variants;

export const listRevealVariants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.025
    }
  }
} satisfies Variants;

export const listItemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: motionTransitions.default
  },
  exit: {
    opacity: 0,
    transition: motionTransitions.feedback
  }
} satisfies Variants;
