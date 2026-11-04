export interface ProjectCardProps {
  title: string;
  status: "on-track" | "at-risk" | "done";
  compact?: boolean;
  progress: number;
  onOpen?: () => void;
  owner: { name: string };
}

/** An app component, listed in the central allowlist. */
export function ProjectCard({ title, status, compact = false, progress, owner }: ProjectCardProps) {
  return (
    <article className="project-card" data-status={status} data-compact={String(compact)}>
      <h3>{title}</h3>
      <p>{owner.name} · {progress}%</p>
    </article>
  );
}

/** Same module, not listed: stays as it is. */
export function ProjectList({ children }: { children?: React.ReactNode }) {
  return <section className="project-list">{children}</section>;
}
