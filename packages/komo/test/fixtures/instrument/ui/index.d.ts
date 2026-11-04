import type { ButtonHTMLAttributes, Component, ForwardRefExoticComponent, MemoExoticComponent, ReactNode, RefAttributes } from "react";

type Variants<T extends Record<string, Record<string, unknown>>> = { [K in keyof T]?: keyof T[K] | null };
declare const buttonVariants: { variant: { primary: string; secondary: string; danger: string }; size: { sm: string; md: string; lg: string } };

export declare const colors: { accent: string; danger: string };
export declare function cx(...names: Array<string | false | undefined>): string;
export declare function useToggle(initial?: boolean): [boolean, () => void];
export declare function ThemeProvider(props: { theme?: "light" | "dark"; children?: ReactNode }): ReactNode;
export declare function CheckIcon(props: { size?: number }): ReactNode;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Variants<typeof buttonVariants> {
  /** Shown instead of children. */
  label?: string;
  disabled?: boolean;
  onPress?: () => void;
  icon?: ReactNode;
}
export declare const Button: ForwardRefExoticComponent<ButtonProps & RefAttributes<HTMLButtonElement>>;

export interface TextFieldProps { label: string; value: string; onValueChange?: (value: string) => void; invalid?: boolean }
export declare function TextField(props: TextFieldProps): ReactNode;

export declare function Counter(props: { tone?: "calm" | "bold"; step?: 1 | 2 | 5 }): ReactNode;
export declare const Badge: MemoExoticComponent<(props: { tone?: "neutral" | "success" | "warning"; children?: ReactNode }) => ReactNode> & { renders?: number };
export declare function Popover(props: { open?: boolean; placement?: "top" | "bottom"; label?: string }): ReactNode;
export declare function Pair(props: { first?: string; second?: string }): ReactNode;
export declare class Panel extends Component<{ elevation?: 0 | 1 | 2; children?: ReactNode }> { render(): ReactNode }
export declare function Tabs(props: { selected?: string; children?: ReactNode }): ReactNode;
export declare namespace Tabs { function Tab(props: { id: string; children?: ReactNode }): ReactNode }
export declare function Avatar(props: { src: string | null; size?: "sm" | "md" | "lg"; caption?: string; author?: string }): ReactNode;
export declare const Tag: MemoExoticComponent<(props: { tone?: "calm" | "bold"; note?: string }) => ReactNode> & { renders?: number };
declare function Quote(props: { author?: string }): ReactNode;
export { Quote as default };
