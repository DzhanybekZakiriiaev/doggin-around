import { cpSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  build: { copyPublicDir: false },
  plugins: [
    {
      name: "public-demo-assets",
      apply: "build",
      writeBundle() {
        const research = resolve("public/models/tricolor-research")
        cpSync(resolve("public"), resolve("dist"), {
          recursive: true,
          filter: (source) => source !== research,
        })
      },
    },
  ],
})
