import { Copy01 } from "@untitledui/icons/Copy01";
import { ChevronSelectorVertical } from "@untitledui/icons/ChevronSelectorVertical";
import { ChevronDown } from "@untitledui/icons/ChevronDown";
import { Edit05 } from "@untitledui/icons/Edit05";
import { Trash01 } from "@untitledui/icons/Trash01";
import { type ComponentType, type SVGProps, type ReactNode } from "react";
import { staticSvg } from "./static-svg.js";
import { InfoCircle } from "@untitledui/icons/InfoCircle";
import { DotsHorizontal } from "@untitledui/icons/DotsHorizontal";
import { User01 } from "@untitledui/icons/User01";
import { SearchLg } from "@untitledui/icons/SearchLg";
import { Plus } from "@untitledui/icons/Plus";
import { MessageChatCircle } from "@untitledui/icons/MessageChatCircle";
import { PointerIcon } from "./PointerIcon.js";
import { LayoutRight } from "@untitledui/icons/LayoutRight";
import { XClose } from "@untitledui/icons/XClose";
import { Check } from "@untitledui/icons/Check";
import { ArrowUp } from "@untitledui/icons/ArrowUp";
import { Link01 } from "@untitledui/icons/Link01";
import { Code02 } from "@untitledui/icons/Code02";
import { SmileIcon } from "./SmileIcon.js";
import { GitBranch01 } from "@untitledui/icons/GitBranch01";
import { DesignIcon } from "./DesignIcon.js";
// Icon components are shared by the DOM and React surfaces.
export type IconName =
  | "chevron"
  | "drawer"
  | "edit"
  | "trash"
  | "info"
  | "more"
  | "person"
  | "search"
  | "plus"
  | "comment"
  | "copy"
  | "pointer"
  | "expand"
  | "close"
  | "check"
  | "arrow"
  | "link"
  | "code"
  | "smile"
  | "branch"
  | "design";
export const components: Record<
  IconName,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  chevron: ChevronDown,
  drawer: ChevronSelectorVertical,
  edit: Edit05,
  trash: Trash01,
  info: InfoCircle,
  more: DotsHorizontal,
  person: User01,
  search: SearchLg,
  plus: Plus,
  comment: MessageChatCircle,
  copy: Copy01,
  pointer: PointerIcon,
  expand: LayoutRight,
  close: XClose,
  check: Check,
  arrow: ArrowUp,
  link: Link01,
  code: Code02,
  smile: SmileIcon,
  branch: GitBranch01,
  design: DesignIcon,
};

// This module is evaluated by the package build, leaving only SVG strings in
// browser code. Source consumers can still evaluate the same pinned icons.
export const iconMarkup = Object.fromEntries(
  Object.entries(components).map(([name, component]) => [
    name,
    staticSvg(
      (component as (props: SVGProps<SVGSVGElement>) => ReactNode)({
        "aria-hidden": true,
      }),
    ),
  ]),
) as Record<IconName, string>;
