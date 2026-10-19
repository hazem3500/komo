type ServerBindings = import("./public-env.js").ServerEnv;

// Wrangler supplies these deployment-specific bindings.
interface Env
  extends Omit<
    ServerBindings,
    "DB" | "PROJECTS" | "GOOGLE_CLIENT_ID" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET"
  > {}

declare module "*.txt" {
  const content: string;
  export default content;
}
