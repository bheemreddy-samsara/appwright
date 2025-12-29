const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LLM_NODE_MODULES = path.join(
  ROOT,
  "node_modules",
  "@empiricalrun",
  "llm",
  "node_modules",
);

const PLATFORM = process.platform;
const ARCH = process.arch;
const LIBVIPS_PACKAGE = `sharp-libvips-${PLATFORM}-${ARCH}`;
const SOURCE = path.join(ROOT, "node_modules", "@img", LIBVIPS_PACKAGE);
const TARGET_DIR = path.join(LLM_NODE_MODULES, "@img");
const TARGET = path.join(TARGET_DIR, LIBVIPS_PACKAGE);

const exists = target => {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
};

const shouldLink = () => {
  if (!exists(LLM_NODE_MODULES)) {
    return false;
  }
  if (!exists(SOURCE)) {
    return false;
  }
  if (exists(TARGET)) {
    return false;
  }
  return true;
};

const link = () => {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  fs.symlinkSync(SOURCE, TARGET, "dir");
};

try {
  if (shouldLink()) {
    link();
  }
} catch (error) {
  // Avoid breaking installs; this is a best-effort fix for optional deps.
  // eslint-disable-next-line no-console
  console.warn("[appwright] Failed to link sharp libvips:", error);
}
