import tseslint from "typescript-eslint";

export default tseslint.config(
  // `.claude/worktrees/` holds whole second checkouts of this repository. Each carries its own
  // tsconfig.json, which gives typescript-eslint a second candidate project root, and it then fails
  // to parse every file in the repo, so one stray worktree breaks `npm run lint` for the main
  // checkout too. Flat config does not read .gitignore, so the path has to be named here as well.
  { ignores: ["**/dist/**", "**/node_modules/**", "site/**", ".claude/worktrees/**"] },
  ...tseslint.configs.recommended,
);
