import type { SVGProps } from "react";

/** Design mode: a selected element inside inspector crop marks. */
export function DesignIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M3 7.5V6a3 3 0 0 1 3-3h1.5m9 0H18a3 3 0 0 1 3 3v1.5m0 9V18a3 3 0 0 1-3 3h-1.5m-9 0H6a3 3 0 0 1-3-3v-1.5M8 8h8v8H8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
