"use client";

import { Workout } from "@/lib/types";
import { WorkoutCard } from "./WorkoutCard";
import { Swipeable, SwipeAction } from "./Swipeable";
import { Icon } from "./icons";
import { useUI } from "./ui";
import { useToast } from "./Toast";

/*
  A workout card you can act on without opening it: swipe right to complete
  (toggle), swipe left to skip. Each fires an undo toast so nothing is a
  one-way door. Race day gets no swipe actions — it's finished from its sheet.
*/
export function SwipeableWorkout({ workout, compact, hint }: { workout: Workout; compact?: boolean; hint?: boolean }) {
  const { today, openWorkout, openCheckin, openLog, actions } = useUI();
  const toast = useToast();
  const isRace = workout.id === "w-race-day";
  const done = workout.status === "done";
  const skipped = workout.status === "skipped";
  // Show the one-tap ✓ only when a completion makes sense — today or earlier,
  // still planned, not a race. Future workouts don't get it (accidental swipe
  // through the plan would otherwise mark a Friday session done on Monday).
  const canQuickDone = !isRace && workout.status === "planned" && workout.date <= today;

  const complete = () => {
    actions.toggleDone(workout.id);
    if (done) {
      toast({ text: "Marked not done", tone: "default", actionLabel: "Undo", onAction: () => actions.toggleDone(workout.id) });
    } else {
      // just completed → open the quick check-in (it carries the celebration + an undo)
      openCheckin(workout.id);
    }
  };

  // One-tap done — the light version of complete(). No check-in sheet, just a
  // toast that credits the planned duration and offers Undo + Log details for
  // anyone who wants to override the defaults. Removes 4-5 taps from the most
  // common "yeah I did it, on-plan" path (the ~80% case).
  const quickComplete = () => {
    actions.toggleDone(workout.id);
    toast({
      text: `Done · ${workout.title}`,
      tone: "success",
      actionLabel: "Log details",
      onAction: () => { actions.toggleDone(workout.id); openLog(); },
    });
  };

  const skip = () => {
    actions.skip(workout.id);
    toast({
      text: `Skipped · ${workout.title}`,
      tone: "warning",
      actionLabel: "Undo",
      onAction: () => actions.unskip(workout.id),
    });
  };

  const right: SwipeAction | undefined = isRace
    ? undefined
    : { label: done ? "Undo" : "Done", icon: <Icon name="check" size={18} />, color: "var(--success)", run: complete };
  const left: SwipeAction | undefined =
    isRace || skipped ? undefined : { label: "Skip", icon: <Icon name="skip" size={18} />, color: "var(--danger)", run: skip };

  return (
    <Swipeable right={right} left={left} hint={hint}>
      <WorkoutCard
        workout={workout}
        onOpen={() => openWorkout(workout.id)}
        compact={compact}
        onQuickComplete={canQuickDone ? quickComplete : undefined}
      />
    </Swipeable>
  );
}
