import React, { useEffect, useState } from "react";

type EventCountdownProps = { startsAt: string | null; endsAt: string | null };
type Unit = { label: string; value: number; width: string };

function ReelValue({ value, label, width }: { value: number; label: string; width: string }) {
  const [rollFrom, setRollFrom] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setRollFrom(value), 500);
    return () => window.clearTimeout(timeout);
  }, [value]);
  const display = String(value).padStart(width === "days" ? 1 : 2, "0");
  const oldDisplay = String(rollFrom).padStart(width === "days" ? 1 : 2, "0");
  return <span aria-label={`${value} ${label.toLowerCase()}`} className="relative inline-flex h-10 min-w-10 overflow-hidden rounded-md border border-border bg-background px-2 font-mono text-2xl font-semibold tabular-nums sm:h-12 sm:min-w-12 sm:text-3xl">
    <span key={display} className="countdown-reel flex flex-col leading-10 sm:leading-[3rem]" data-from={oldDisplay} aria-hidden="true"><span>{display}</span><span>{oldDisplay}</span></span>
  </span>;
}

export const EventCountdown: React.FC<EventCountdownProps> = ({ startsAt, endsAt }) => {
  const startTime = startsAt ? Date.parse(startsAt) : Number.NaN;
  const endTime = endsAt ? Date.parse(endsAt) : Number.NaN;
  const hasSchedule = Number.isFinite(startTime) || Number.isFinite(endTime);
  const [now, setNow] = useState(() => Date.now());
  const shouldTick = startTime > now || endTime > now;

  useEffect(() => {
    if (!shouldTick) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [shouldTick]);

  if (!hasSchedule) return null;

  const target = startTime > now ? startTime : endTime > now ? endTime : null;
  if (target === null) return <p className="mt-5 text-sm font-medium text-muted-foreground" role="status">Event has ended</p>;

  const totalSeconds = Math.max(0, Math.ceil((target - now) / 1000));
  const units: Unit[] = [
    { label: "Days", value: Math.floor(totalSeconds / 86400), width: "days" },
    { label: "Hours", value: Math.floor(totalSeconds / 3600) % 24, width: "hours" },
    { label: "Minutes", value: Math.floor(totalSeconds / 60) % 60, width: "minutes" },
    { label: "Seconds", value: totalSeconds % 60, width: "seconds" },
  ];
  return <section className="mt-5" aria-label="Event countdown">
    <p className="mb-2 text-sm font-medium text-muted-foreground">{startTime > now ? "Starts in" : "Ends in"}</p>
    <div className="flex flex-wrap gap-2" role="timer" aria-live="off">
      {units.map((unit) => <div key={unit.label} className="flex flex-col items-center gap-1">
        <ReelValue value={unit.value} label={unit.label} width={unit.width} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{unit.label}</span>
      </div>)}
    </div>
  </section>;
};
