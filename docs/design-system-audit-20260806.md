# Design System Audit - 2026-08-06

## Baseline

- Framework: Next.js 16.2.12 App Router with React 19.2.5.
- Styling: Tailwind CSS 4.3.3 through `@tailwindcss/postcss` and `@import "tailwindcss"`.
- Package manager: npm (`package-lock.json`).
- shadcn/ui: not initialized. There is no `components.json` or `src/components/ui` directory, so no Radix-to-Base or Base-to-Radix migration exists.
- Motion: GSAP is installed, but Motion for React is not installed.
- Lint: no lint script or ESLint configuration exists.
- Typecheck: passed.
- Tests: 8 files and 29 tests passed.
- Production build: passed. The existing webpack cache snapshot warnings are non-blocking.

## Current Visual System

The current stylesheet already has a useful first-generation token layer:

- Colors: eggshell, powder, chalk, fog, gravel, slate, cinder, obsidian, and a Local Studio green.
- Type sizes: 10px through 48px.
- Spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, and 96px.
- Radius: 4px control, 18px card, 24px panel, and pill.
- Shadows: inset, card, and button.
- Motion: 150ms fast, 300ms base, and one shared easing curve.

However, these primitives are not consistently semantic or enforced:

- `src/app/globals.css` is 3,013 lines, 61,955 bytes, and contains about 365 class selectors.
- It contains 169 raw color occurrences across 85 unique color values.
- `#ffffff` is repeated 31 times instead of using a surface token.
- Radius tokens coexist with 11 raw `9999px` values and raw 4, 6, 7, 14, 16, 18, 22, 24, and 32px radii.
- Shared shadows coexist with many one-off shadows, including modal, active-control, card-hover, and floating-control values.
- Spacing tokens coexist with repeated raw 2, 4, 5, 6, 8, 10, 12, 14, 16, 18, 24, 28, 32, and 36px values.
- There are many local transitions but no global reduced-motion CSS policy.
- There is no dark-mode token set.
- The body still references unavailable custom or web-font names before its system fallbacks.

## Repeated Components

There are 79 directly rendered buttons, inputs, textareas, selects, details elements, or custom dialog controls across `mockup-generator.tsx` and `template-setup-studio.tsx`.

Repeated button systems:

- `button-primary`
- `secondary-link-button`
- `category-filter-button`
- `quick-color-button`
- `quick-choice-button`
- `pantone-option-button`
- `icon-action-button`
- `rotation-pill-button`
- `text-button` and `button-reset`

Repeated surface systems:

- `surface`, `notice-panel`, and `stat-card`
- `catalog-card` and `workflow-step-card`
- `part-card` and `part-selection-card`
- `material-instance-card`
- `logo-adjust-panel`
- custom instruction modal and backdrop

Repeated control systems:

- `input-shell` is shared informally by input, textarea, select, file, and number controls.
- Toggle-like buttons reimplement selected, hover, disabled, and focus states.
- The instruction modal implements focus and overlay behavior manually.
- The Pantone listbox and step navigation are custom controls that can later adopt Popover, Command, Tabs, and ToggleGroup primitives without changing their data flow.

Repeated shell systems:

- The logo, toolbar actions, page width, and header border are repeated in the catalog, mockup, and setup components.
- Floating and translucent surfaces do not share one material definition.

## Pilot Route

The `/` product catalog is the safest representative pilot because it exercises:

- application shell and toolbar;
- primary and secondary actions;
- product cards and metadata badges;
- loading, empty, and recoverable remote-data states;
- desktop, tablet, mobile, dark-mode, keyboard, and reduced-motion behavior.

It does not touch mockup rendering, Supabase contracts, Local Studio writes, form submissions, routes, or URL behavior.

## Migration Boundaries

- Initialize shadcn/ui once, using Radix primitives because the project has no existing primitive base to preserve.
- Keep the Chili green as the brand accent while retaining neutral foreground and surface colors.
- Use system font stacks only; do not embed SF Pro.
- Add semantic tokens without deleting compatibility tokens used by untouched routes.
- Add shared UI primitives first, then migrate only `/` in this pilot.
- Keep glass materials limited to navigation and floating overlays.
- Keep cards, forms, tables, and product content solid.

## Recommended Route Order After Pilot

1. `/` product catalog pilot.
2. Shared mockup shell and navigation on `/mockup` and `/mockup/[productSlug]`.
3. Mockup configuration controls, tabs, popovers, sliders, and instruction dialog.
4. `/setup` Local Asset Library shell and catalog sidebar.
5. Local Studio form controls and material cards in small, separately validated sections.
6. Remaining loading, empty, error, and debug surfaces.

## Pilot Implementation

- Initialized shadcn/ui once with the `radix-nova` style and Radix UI base. No primitive migration was required.
- Added semantic light and dark tokens for backgrounds, surfaces, text, borders, inputs, brand actions, destructive actions, focus, radii, shadows, and motion.
- Kept the existing Chili green as the primary accent and switched typography to the platform system stack.
- Added shared Radix/shadcn primitives under `src/components/ui` rather than creating parallel branded controls.
- Added `src/components/providers/interface-provider.tsx` for shared Tooltip and Motion configuration.
- Added `src/lib/motion.ts` for restrained feedback, panel, spring, page, and list transitions.
- Added `src/components/application-shell.tsx` with a translucent floating toolbar and solid content area.
- Migrated only `/`; Supabase loading, local catalog merging, href selection, and route behavior remain unchanged.
- Added loading, slow-sync, recoverable error, and empty presentations without adding request timeouts or changing data order.
- Added `content-visibility` for catalog cards so future large catalogs avoid painting off-screen cards.

## Pilot Review

- Desktop: three-column catalog and compact status panel verified at 1440px.
- Tablet: two-column catalog and stacked status panel verified at 834px.
- Mobile: one-column catalog and wrapped toolbar verified at 390px with no horizontal overflow.
- Dark mode: semantic token switch verified with a temporary root class, then removed so untouched routes remain unchanged.
- Keyboard: navigation links and product cards retain native link behavior and visible focus rings; a skip link now targets main content.
- Reduced motion: MotionConfig follows the user preference and CSS removes nonessential transition duration under `prefers-reduced-motion`.
- Accessibility: semantic landmarks and heading hierarchy, alt text, intrinsic image dimensions, live status, error alert, touch targets, and decorative icon handling reviewed against the current Web Interface Guidelines.
- Performance: LazyMotion uses `domAnimation`, non-urgent catalog updates use `startTransition`, and large-list stagger/layout measurement was removed.
