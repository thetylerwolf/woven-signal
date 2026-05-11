import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const isCi = process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  // On GitHub Pages project sites, assets must be served from /<repo>/.
  base: isCi && repoName ? `/${repoName}/` : "/",
});
