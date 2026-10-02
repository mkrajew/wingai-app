import { Fragment, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import "./SegmentedSwitch.css";

export type SegmentedOption<V extends string> = {
  value: V;
  label: string;
  icon: ReactNode;
};

type Props<V extends string> = {
  label: string;
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
};

export default function SegmentedSwitch<V extends string>({
  label,
  options,
  value,
  onChange,
}: Props<V>) {
  const labelId = useId();
  const segRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The segment whose icon animation last played. `run` changes every time an
  // animation is started, so re-clicking the active option replays it.
  const [played, setPlayed] = useState<{ index: number; run: number } | null>(
    null,
  );

  const activeIndex = options.findIndex((o) => o.value === value);

  // The active segment also changes when the parent changes `value` by itself
  // (e.g. the other switch forcing this one). Play the new segment's animation
  // then too; a change caused by a click here has already queued its own.
  const [seenIndex, setSeenIndex] = useState(activeIndex);
  if (seenIndex !== activeIndex) {
    setSeenIndex(activeIndex);
    if (played?.index !== activeIndex) {
      setPlayed({ index: activeIndex, run: (played?.run ?? 0) + 1 });
    }
  }

  const select = (index: number) => {
    onChange(options[index].value);
    setPlayed((prev) => ({ index, run: (prev?.run ?? 0) + 1 }));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const count = options.length;
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (activeIndex + 1) % count;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (activeIndex - 1 + count) % count;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = count - 1;
    } else {
      return;
    }
    e.preventDefault();
    select(next);
    segRefs.current[next]?.focus();
  };

  return (
    <div className="seg-switch-field">
      <span id={labelId} className="seg-switch-label">
        {label}
      </span>
      <div
        className="seg-switch"
        role="radiogroup"
        aria-labelledby={labelId}
        style={{ "--i": activeIndex } as CSSProperties}
        onKeyDown={handleKeyDown}
      >
        <span className="seg-switch-thumb" aria-hidden="true" />
        {options.map((option, i) => {
          const checked = i === activeIndex;
          const run = played?.index === i ? played.run : 0;
          return (
            <button
              key={option.value}
              ref={(el) => {
                segRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.label}
              title={option.label}
              tabIndex={checked ? 0 : -1}
              className={run > 0 ? "seg-switch-seg is-playing" : "seg-switch-seg"}
              onClick={() => select(i)}
            >
              {/* New key = remounted icon = its CSS animation starts over */}
              <Fragment key={run}>{option.icon}</Fragment>
            </button>
          );
        })}
      </div>
    </div>
  );
}
