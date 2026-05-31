---
name: Warm Amber Minimalism
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#514532'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f1f1f1'
  outline: '#837560'
  outline-variant: '#d5c4ab'
  surface-tint: '#7c5800'
  primary: '#7c5800'
  on-primary: '#ffffff'
  primary-container: '#ffb800'
  on-primary-container: '#6b4c00'
  inverse-primary: '#ffba20'
  secondary: '#645e54'
  on-secondary: '#ffffff'
  secondary-container: '#ebe1d4'
  on-secondary-container: '#6a6359'
  tertiary: '#a53c03'
  on-tertiary: '#ffffff'
  tertiary-container: '#ffb395'
  on-tertiary-container: '#913200'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdea8'
  primary-fixed-dim: '#ffba20'
  on-primary-fixed: '#271900'
  on-primary-fixed-variant: '#5e4200'
  secondary-fixed: '#ebe1d4'
  secondary-fixed-dim: '#cec5b9'
  on-secondary-fixed: '#1f1b13'
  on-secondary-fixed-variant: '#4c463d'
  tertiary-fixed: '#ffdbce'
  tertiary-fixed-dim: '#ffb599'
  on-tertiary-fixed: '#370e00'
  on-tertiary-fixed-variant: '#7f2b00'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
  text-main: '#222222'
  text-muted: '#666666'
  success-emerald: '#27C26C'
  surface-white: '#FFFFFF'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  display-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-padding: 20px
  stack-gap-sm: 8px
  stack-gap-md: 16px
  stack-gap-lg: 24px
  grid-gutter: 12px
---

## Brand & Style

The design system is centered on **Warm Minimalism**, a style that balances the precision of modern UI with the emotional resonance of family-oriented photography. It targets young parents and social-media-active individuals who seek a "premium but approachable" aesthetic for their digital memories.

The visual narrative is driven by:
- **Soft Premiumism:** Avoiding the coldness of typical tech products by using organic curves and cream-based neutrals.
- **Joyful Clarity:** Utilizing high-visibility brand colors to guide the user through the AI generation process without friction.
- **Friendly Sophistication:** Combining a "Pixar-esque" softness with structured layouts to ensure the product feels both fun and technologically advanced.

The interface leverages **Glassmorphism** for secondary overlays and **Tactile** elements (soft shadows and large radii) to create a UI that feels physically inviting, like a well-curated photo album.

## Colors

The palette is anchored by **Warm Amber**, evoking sunlight and optimism. 

- **Primary (#FFB800):** Used for core actions, progress indicators, and active states. It should be the most prominent chromatic element.
- **Secondary (#FFF5E8):** A soft cream used for large container backgrounds and subtle section differentiation to avoid the harshness of pure white.
- **Accent (#FF7D45):** A soft orange reserved for highlights, badges, and secondary promotional elements (e.g., "New" style labels).
- **Background (#F8F8F8):** The base canvas color, providing a clean, off-white foundation that makes the cream and amber elements pop.
- **Text (#222222):** Deep charcoal ensures high legibility while remaining softer than pure black.

## Typography

The system utilizes **Plus Jakarta Sans** for headings to provide a friendly, rounded geometric feel that aligns with the "Pixar" aesthetic. **Be Vietnam Pro** is used for body text and labels for its contemporary warmth and excellent legibility at small sizes.

For Chinese characters, the system defaults to **PingFang SC** (iOS) and **Noto Sans SC** (Android/Generic), maintaining a "system-native" feel that ensures speed and familiarity within the WeChat environment.

- **Weight Usage:** Use Bold (700) and SemiBold (600) strictly for information hierarchy. Avoid Light weights to maintain an "approachable/sturdy" brand voice.
- **Contrast:** Maintain a clear distinction between the Charcoal text and the Cream/White backgrounds to ensure accessibility for all age groups.

## Layout & Spacing

This design system follows a strict **8pt grid system** to ensure consistency across the varying screen sizes of the WeChat ecosystem. 

- **Layout Model:** A fluid grid with fixed outer margins of **20px**. 
- **Content Flow:** Elements are organized in vertical stacks with standard gaps of 16px or 24px.
- **Card Grids:** Style selection and result previews use a 2-column grid with a 12px gutter.
- **Safe Areas:** Adhere strictly to WeChat Mini Program "Capsule Button" safe areas at the top of the screen. Navigation and core headers must be vertically centered relative to the capsule.

## Elevation & Depth

Visual hierarchy is established through **Ambient Shadows** and **Tonal Layers**.

- **Shadow Profile:** Shadows are extremely diffused with low opacity (10-15%) and a subtle warm tint (`rgba(255, 184, 0, 0.1)`) to keep them "friendly" rather than "heavy."
- **Layering:** 
    - **Level 0 (Background):** #F8F8F8
    - **Level 1 (Cards/Surface):** #FFFFFF with a 24px corner radius and a soft shadow.
    - **Level 2 (Modals/Floating Actions):** Elevated with a more pronounced shadow (y: 8px, blur: 24px).
- **Interactive Depth:** Buttons use a very subtle "pressed" state where the shadow disappears and the scale reduces slightly (98%) to mimic a physical click.

## Shapes

The shape language is defined by extreme roundedness to evoke safety and friendliness. 

- **Standard Containers:** Use a **24px** radius (`rounded-xl` equivalent in this system).
- **Secondary Elements:** Small cards and input fields use a **16px** radius.
- **Interactive Elements:** Primary and secondary buttons are always **Pill-shaped (999px)** to maximize the "friendly/touchable" feel.
- **Visual Consistency:** Ensure that even image containers within cards maintain the 24px radius or at least a 12px radius if nested.

## Components

### Buttons
- **Primary:** Full-width, pill-shaped, #FFB800 background with #222222 text. Includes a soft amber shadow.
- **Ghost/Secondary:** Pill-shaped, transparent background with #FFB800 border (2px) or a #FFF5E8 background for a softer look.

### Cards (Style Selection)
- **Structure:** 24px radius, overflow hidden.
- **Active State:** A 3px border in #FFB800 with a checkmark icon in the top right corner (accentuated by a small floating shadow).
- **Content:** The style name should be overlaid on the bottom of the image using a semi-transparent dark-to-transparent gradient for legibility.

### Input Fields & Uploaders
- **Uploader:** A large dashed-border area with a 24px radius. Use #FFB800 for the icon and primary text within the uploader to encourage interaction.
- **Checkboxes:** Rounded corners (4px-6px) rather than sharp squares, using #FFB800 for the checked state.

### Chips & Badges
- **Status Chips:** Small, pill-shaped with #FFF5E8 background and #FF7D45 text for "New" or "Hot" styles.

### Loading & Progress
- **Animation:** Use a pulsing "shimmer" effect on cards during AI generation.
- **Progress Bar:** 8px height, rounded ends, using #FFB800 on a #FFF5E8 track.