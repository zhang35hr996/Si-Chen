// Deliberately minimal (skeleton-plan §12 DoD): the only rule lint exists to
// enforce in PR 1 is the architecture boundary — src/engine/** is framework-free
// and imports nothing from the layers above it. Don't grow the toolchain.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
  },
  {
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-*", "react/*", "react-dom/*"],
              message: "engine/ is framework-free: no React imports (DESIGN §2.1).",
            },
            {
              group: ["**/ui/**", "**/store/**", "*.tsx"],
              message: "engine/ imports nothing above it: no ui/ or store/ (DESIGN §2.2).",
            },
          ],
        },
      ],
    },
  },
);
