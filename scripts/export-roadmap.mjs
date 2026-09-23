import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const root = path.resolve(import.meta.dirname, "..")
const source = fs.readFileSync(path.join(root, "src/data/computer-vision-roadmap.ts"), "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const sandbox = { exports: {} }
vm.runInNewContext(compiled, sandbox)
const snapshot = {
  title: "Computer Vision Roadmap",
  stages: sandbox.exports.STAGES,
  nodes: sandbox.exports.NODES.map((node) => ({ ...node, status: "not-started" })),
}
fs.writeFileSync(
  path.join(root, "services/api/seed-roadmap.json"),
  `${JSON.stringify(snapshot, null, 2)}\n`,
)
console.log(`Exported ${snapshot.nodes.length} nodes across ${snapshot.stages.length} stages.`)
