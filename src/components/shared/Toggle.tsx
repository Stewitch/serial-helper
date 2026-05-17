import { memo } from "react";

interface ToggleProps {
  active: boolean;
  onClick: () => void;
}

export const Toggle = memo(function Toggle({ active, onClick }: ToggleProps) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={`relative w-9 h-5 rounded-full cursor-pointer transition-all duration-300 ease-in-out border ${
        active
          ? "bg-accent border-accent shadow-[0_0_6px_rgba(37,99,235,0.35)]"
          : "bg-[#d4d4d4] dark:bg-[#3a3a40] border-[#c0c0c0] dark:border-[#505058] shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] hover:border-border-strong"
      }`}
    >
      <span
        className="absolute top-1/2 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow-sm"
        style={{
          transform: active ? "translate(18px, -50%)" : "translate(0, -50%)",
          transition: "transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
    </button>
  );
});
