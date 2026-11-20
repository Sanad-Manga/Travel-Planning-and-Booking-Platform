export interface StepsProps {
  /** The step names in order, e.g. ["Choose flight", "Passenger details", "Pay"]. */
  steps: string[];
  /** The current step, counted from 1. */
  current: number;
}

/** GEN-15: shows where you are in a short flow. Keep flows to three steps or fewer. */
export function Steps({ steps, current }: StepsProps) {
  const position = Math.min(Math.max(Math.trunc(current) || 1, 1), steps.length);
  return (
    <div className="steps">
      <p className="steps-summary">
        Step {position} of {steps.length}
      </p>
      <ol className="steps-list" aria-label="Progress">
        {steps.map((label, index) => {
          const number = index + 1;
          const state = number < position ? 'done' : number === position ? 'current' : 'todo';
          return (
            <li
              key={label}
              className={`step step-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="step-number" aria-hidden="true">
                {number}
              </span>
              <span className="step-label">{label}</span>
              {state === 'done' ? <span className="visually-hidden"> (completed)</span> : null}
              {state === 'todo' ? <span className="visually-hidden"> (not started)</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
