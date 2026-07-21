"use client";

import { Workout } from "@/lib/types";
import { WorkoutCard } from "./WorkoutCard";
import { Swipeable, SwipeAction } from "./Swipeable";
import { useUI } from "./ui";
import { useToast } from "./Toast";

/*
  A workout card you can act on without opening it: swipe right to complete
  (toggle), swipe left to skip. Each fires an undo toast so nothing is a
  one-way door. Race day gets no swipe actions — it's finished from its sheet.
*/
export function SwipeableWorkout({ workout, compact }: { workout: Workout; compact?: boolean }) {
  const { openWorkout, actions } = useUI();
  const toast = useToast();
  const isRace = workout.id === "w-race-day";
  const done = workout.status === "done";
  const skipped = workout.status === "skipped";

  const complete = () => {
    actions.toggleDone(workout.id);
    toast({
      text: done ? "Marked not done" : "Session complete 💪",
      tone: "success",
      actionLabel: "Undo",
      onAction: () => actions.toggleDone(workout.id),
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
    : { label: done ? "Undo" : "Done", icon: "✓", color: "var(--success)", run: complete };
  const left: SwipeAction | undefined =
    isRace || skipped ? undefined : { label: "Skip", icon: "⏭", color: "var(--danger)", run: skip };

  return (
    <Swipeable right={right} left={left}>
      <WorkoutCard workout={workout} onOpen={() => openWorkout(workout.id)} compact={compact} />
    </Swipeable>
  );
}
