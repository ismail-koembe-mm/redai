import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import fastGlob from "fast-glob";
import ignore from "ignore";

const defaultIgnorePatterns = [
  ".git/**",
  "**/node_modules/**",
  "**/vendor/**",           // PHP dependencies at any depth
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/tmp/**",
  "**/temp/**",
  "**/var/**",              // Symfony cache and logs
  "**/pipeline-tests/**",  // Cypress test suites per service
  "**/testing-cypress/**", // Global cypress testing directory
  "**/fixtures/**",        // Test fixtures
  "**/migrations/**",      // Database migrations
  "**/translations/**",    // Translation files
  ".agents/**",            // Avoid scanning agent skill files injected by RedAI
];

const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".h",
  ".js",
  ".jsx",
  ".go",
  ".json",
  ".m",
  ".mjs",
  ".mm",
  ".mts",
  ".php",   // PHP source files
  ".py",
  ".swift",
  ".ts",
  ".tsx",
  ".twig",  // Symfony/Twig templates — can contain XSS vectors
]);

const sourceBasenames = new Set([
  ".env.example",
  ".env.sample",
  "Dockerfile",
  "Gemfile",
  "Makefile",
  "Podfile",
  "package.json",
  "tsconfig.json",
  "composer.json",  // PHP dependency manifest — important for supply chain
]);

export interface SourceFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
}

export interface WalkSourceFilesOptions {
  maxFileSizeBytes?: number;
}

export async function walkSourceFiles(
  rootDir: string,
  options: WalkSourceFilesOptions = {},
): Promise<SourceFile[]> {
  const absoluteRoot = resolve(rootDir);
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 512 * 1024;
  const gitignore = await loadRootGitignore(absoluteRoot);

  const entries = await fastGlob("**/*", {
    cwd: absoluteRoot,
    absolute: true,
    dot: true,
    followSymbolicLinks: false,
    onlyFiles: true,
    unique: true,
    ignore: defaultIgnorePatterns,
  });

  const files: SourceFile[] = [];
  for (const absolutePath of entries) {
    const relativePath = normalizePath(relative(absoluteRoot, absolutePath));
    if (gitignore.ignores(relativePath)) continue;
    if (!isSourceRelevant(relativePath)) continue;

    const fileStat = await stat(absolutePath);
    if (fileStat.size > maxFileSizeBytes) continue;

    files.push({
      absolutePath,
      relativePath,
      extension: extname(relativePath),
      sizeBytes: fileStat.size,
    });
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function loadRootGitignore(rootDir: string) {
  const matcher = ignore().add(defaultIgnorePatterns);
  const gitignorePath = resolve(rootDir, ".gitignore");
  if (existsSync(gitignorePath)) {
    matcher.add(await readFile(gitignorePath, "utf8"));
  }
  return matcher;
}

function isSourceRelevant(relativePath: string): boolean {
  const basename = relativePath.split("/").at(-1) ?? relativePath;
  if (sourceBasenames.has(basename)) return true;
  if (looksSecretLike(basename)) return false;
  if (looksTestLike(relativePath)) return false;
  return sourceExtensions.has(extname(relativePath));
}

// Detect test files, fixtures, snapshots, and generated code
function looksTestLike(relativePath: string): boolean {
  // Skip known test directories
  if (/\/(cypress|__tests__|__mocks__|__fixtures__|__snapshots__|stories|storybook|pipeline-tests|testing-cypress)\//i.test(relativePath)) return true;
  // Skip test files by extension pattern (JS/TS and PHP)
  if (/\.(test|spec|story|stories|mock|fixture|stub)\.(ts|tsx|js|jsx|php)$/.test(relativePath)) return true;
  // Skip Jest/Vitest snapshot files
  if (relativePath.endsWith(".snap")) return true;
  return false;
}

function looksSecretLike(basename: string): boolean {
  if (basename === ".env") return true;
  if (basename.startsWith(".env."))
    return !basename.endsWith(".example") && !basename.endsWith(".sample");
  return false;
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}