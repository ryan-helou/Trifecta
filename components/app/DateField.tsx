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
    </div>
  );
}
