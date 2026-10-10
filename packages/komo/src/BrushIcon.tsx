import type { SVGProps } from "react";

export function BrushIcon(props: SVGProps<SVGSVGElement>) {
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
        d="m14.4 6.2 3.4 3.4M4.5 19.5c1.8 0 3.1-.6 4.3-1.8 1.3-1.3 1.4-3.2 2.7-4.5l6.8-6.8a2.4 2.4 0 0 0-3.4-3.4l-6.8 6.8c-1.3 1.3-3.2 1.4-4.5 2.7-1.2 1.2-1.8 2.5-1.8 4.3v2.7h2.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
