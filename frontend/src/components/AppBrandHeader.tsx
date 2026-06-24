import { IconDice, IconScales } from "../Icons";

export function AppBrandHeader({
  demoMode,
  fullAccess,
}: {
  demoMode: boolean;
  fullAccess: boolean;
}) {
  return (
    <>
      <div className="brand-mark" aria-hidden="true">
        <IconScales className="icon icon-lg" />
      </div>
      <div className="brand-copy">
        <p className="brand-eyebrow">Tableside rules engine</p>
        <h1>
          <span className="brand-title-main">Rules</span>
          <span className="brand-title-accent">Referee</span>
        </h1>
        <p>
          {demoMode && !fullAccess
            ? "Try the sample rulebook — ask questions and see cited rulings."
            : "Settle arguments with cited rulings — upload a rulebook and roll."}
        </p>
      </div>
      <div className="header-dice" aria-hidden="true">
        <IconDice className="icon icon-lg" />
      </div>
    </>
  );
}
