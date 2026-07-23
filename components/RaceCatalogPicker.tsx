"use client";

import { useMemo, useState } from "react";
import {
  CatalogRace,
  RaceCategory,
  RACE_CATALOG,
  distanceLabel,
  swimLabel,
  terrainLabel,
} from "@/lib/raceCatalog";
import { fmtMonthYear, fmtShortDate, todayISO } from "@/lib/dates";
import { Icon } from "./app/icons";

const DIST_FILTERS: { key: "all" | RaceCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "olympic", label: "Olympic" },
  { key: "half", label: "70.3" },
  { key: "full", label: "Full" },
];

const CHAMPIONSHIP: (string | undefined)[] = ["World Championship", "European Championship"];

/**
 * Searchable, filterable list of real races grouped by month. Selecting one
 * calls `onPick` with the event — callers pre-fill the distance category + race
 * date from it. Past-dated catalog entries are hidden so stale seed rows degrade
 * gracefully.
 */
export function RaceCatalogPicker({
  selectedId,
  onPick,
}: {
  selectedId?: string;
  onPick: (race: CatalogRace) => void;
}) {
  const [q, setQ] = useState("");
  const [dist, setDist] = useState<"all" | RaceCategory>("all");

  const list = useMemo(() => {
    const today = todayISO();
    const s = q.trim().toLowerCase();
    return RACE_CATALOG.filter((r) => r.dateISO > today)
      .filter((r) => dist === "all" || r.distance === dist)
      .filter((r) => (s ? `${r.name} ${r.location} ${r.country} ${r.series}`.toLowerCase().includes(s) : true));
  }, [q, dist]);

  // group by month-year, preserving date order (list is already sorted)
  const groups = useMemo(() => {
    const out: { key: string; races: CatalogRace[] }[] = [];
    for (const r of list) {
      const key = fmtMonthYear(r.dateISO);
      const last = out[out.length - 1];
      if (last && last.key === key) last.races.push(r);
      else out.push({ key, races: [r] });
    }
    return out;
  }, [list]);

  return (
    <div>
      <input
        className="input"
        placeholder="Search race, city, or country…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-2.5 flex gap-2">
        {DIST_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setDist(f.key)}
            className={`chip flex-1 justify-center ${dist === f.key ? "is-selected" : ""}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-2 px-0.5 text-xs text-muted">
        {list.length} race{list.length === 1 ? "" : "s"}
      </div>

      <div className="mt-1.5 max-h-80 space-y-4 overflow-y-auto pr-1">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="eyebrow mb-1.5 px-1 text-[0.68rem]">
              {g.key}
            </div>
            <div className="space-y-2">
              {g.races.map((r) => {
                const active = r.id === selectedId;
                const champ = r.tags?.some((t) => CHAMPIONSHIP.includes(t));
                return (
                  <button
                    key={r.id}
                    onClick={() => onPick(r)}
                    className={`flex w-full items-start justify-between gap-3 rounded-2xl border p-3.5 text-left transition ${
                      active ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-line bg-surface-2 hover:bg-surface-3"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-display font-semibold">{r.name}</span>
                        {champ && <span className="shrink-0 text-accent"><Icon name="trophy" size={14} /></span>}
                      </div>
                      <div className="truncate text-sm text-muted">
                        {r.location}, {r.country}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {terrainLabel(r.terrain)} · {swimLabel(r.swim)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums">{fmtShortDate(r.dateISO)}</div>
                      <div className="mt-1 inline-block rounded-full border border-line px-2 py-0.5 text-[0.65rem] font-semibold text-muted">
                        {distanceLabel(r.distance)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <p className="px-1 py-4 text-sm text-muted">
            No matching races — switch to “By distance” to set your own date.
          </p>
        )}
      </div>
    </div>
  );
}
