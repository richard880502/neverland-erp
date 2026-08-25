import { prisma } from "../lib/prisma";
import { createApiKey } from "../lib/api-key";

function parseLabel(): string {
  const args = process.argv.slice(2);
  const flagIndex = args.findIndex((arg) => arg === "--label");
  if (flagIndex !== -1 && args[flagIndex + 1]) return args[flagIndex + 1];
  const eqArg = args.find((arg) => arg.startsWith("--label="));
  if (eqArg) return eqArg.slice("--label=".length);
  if (args[0] && !args[0].startsWith("--")) return args[0];
  throw new Error("請提供 label，例如：npm run create-api-key -- --label \"Medusa Production\"");
}

async function main() {
  const label = parseLabel();
  const apiKey = await createApiKey(label);

  console.log("已建立新的 API Key：");
  console.log(`  id:    ${apiKey.id}`);
  console.log(`  label: ${apiKey.label}`);
  console.log("");
  console.log("以下是明文金鑰，僅顯示這一次，請立即安全保存：");
  console.log("");
  console.log(apiKey.plaintext);
  console.log("");
  console.log("此金鑰不會再顯示，若遺失請重新建立一把新的 key。");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
