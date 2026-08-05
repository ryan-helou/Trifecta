"use client";

// ---------------------------------------------------------------------------
// A date input that still looks like a control when it's empty.
//
// `<input type="date">` with no value renders "mm/dd/yyyy" in desktop browsers and
// ABSOLUTELY NOTHING in iOS WKWebView — an empty grey box with no label, no icon,
// and no hint that it can be tapped. That is invisible from the source and from any
// desktop browser; it only shows up on a device. It shipped on the race-date step,
// which is step 2 of onboarding and the field the entire plan counts back from.
//
// A CSS pseudo-element won't fix it reliably (WebKit renders date inputs from a
// shadow tree and support for ::before on them is inconsistent), so the placeholder
// is a real, aria-hidden sibling shown only while the value is empty. The native
// picker still does all the work.
//
// The catch, and the second bug: browsers that DO render something for an empty date
// input (Chrome/Android show "mm/dd/yyyy" or "yyyy-mm-dd") then draw it UNDERNEATH our
// overlay, so the race-date field read as two strings stacked on top of each other —
// "Pick your race date" and "yyyy-mm-dd" overlapping, illegible. While the value is
// empty the input's own text is therefore transparent; the overlay is the only text.
// It goes back to inherit the moment there's a real date to show.
// ---------------------------------------------------------------------------

export function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = "Select a date",
  className = "",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div className="relative">
      <input
        className={`input ${className}`}
        type="date"
        min={min}
        max={max}
        value={value}
        aria-label={ariaLabel ?? placeholder}
        /* Inline, not a `text-transparent` utility: `.input` is a component-layer class
           and wins the cascade against it. `-webkit-text-fill-color` is the one WebKit
           actually honours inside the date field's shadow tree. */
        style={value ? undefined : { color: "transparent", WebkitTextFillColor: "transparent" }}
        onChange={(e) => onChange(e.target.value)}
      />
      {!value && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-[0.95rem] flex items-center text-faint"
        >
          {placeholder}
        </span>
      )}
      {/* A calendar glyph, always. iOS renders NO indicator of its own inside a date
          input, so with the native text hidden the field was a flat grey box with grey
          text — it reads as a caption or a disabled field, not something you tap. That
          is the half of ticket #96 the placeholder alone didn't fix. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-[0.95rem] flex items-center text-faint"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </span>
    </div>
  );
}
