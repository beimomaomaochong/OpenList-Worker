import esbuild from "esbuild"
import fs from "fs"

/**
 * 边缘与 Serverless 构建专用插件：把 sftp / ftp 驱动及 ssh2 相关依赖替换为空模块。
 */
const emptyNodeDriverPlugin = {
  name: "empty-node-driver",
  setup(build) {
    build.onResolve({ filter: /drivers[\\/](sftp|ftp)([\\/].*)?$/ }, (args) => {
      return { path: args.path, namespace: "empty-node-driver" }
    })
    build.onResolve({ filter: /^(ssh2|cpu-features|iconv-lite)(\/.*)?$/ }, (args) => {
      return { path: args.path, namespace: "empty-node-driver" }
    })
    build.onResolve({ filter: /^mysql2(\/.*)?$/ }, (args) => {
      return { path: args.path, namespace: "empty-node-driver" }
    })
    build.onLoad(
      { filter: /.*/, namespace: "empty-node-driver" },
      () => {
        return {
          contents: `
// Empty stub for Edge/CloudFunction build — Node-only drivers (sftp/ftp/ssh2/mysql2) are not available in edge/serverless isolates.
export const SFTPDriver = class { constructor() { throw new Error("[Edge/Serverless] SFTP driver requires full Node.js runtime"); } };
export const normalizeSFTPAddition = (v) => v;
export const FTPDriver = class { constructor() { throw new Error("[Edge/Serverless] FTP driver requires full Node.js runtime"); } };
export const SFTPClient = class { constructor() { throw new Error("[Edge/Serverless] SFTP client requires full Node.js runtime"); } };
export const parseAddress = () => ({ host: "127.0.0.1", port: 22 });
export const Client = class { constructor() { throw new Error("[Edge/Serverless] ssh2 is not available in edge/serverless runtime"); } };
export const createPool = () => { throw new Error("[Edge/Serverless] mysql2 is not available in edge/serverless runtime"); };
export default {};
`,
          loader: "js",
        }
      },
    )
  },
}

/**
 * dist/index.html 的换行符随获取途径而变，统一归一为 LF。
 */
const normalizeHtmlEolPlugin = {
  name: "normalize-html-eol",
  setup(build) {
    build.onLoad({ filter: /\.html$/ }, async (args) => {
      const contents = await fs.promises.readFile(args.path, "utf8")
      return { contents: contents.replace(/\r\n?/g, "\n"), loader: "text" }
    })
  },
}

async function build() {
  await esbuild.build({
    entryPoints: ["api/[...route].ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    outfile: "dist-server/api/[...route].js",
    minify: true,
    format: "esm",
    mainFields: ["module", "main"],
    external: ["ssh2", "cpu-features", "iconv-lite", "mysql2", "node:*"],
    loader: { ".node": "empty" },
    plugins: [emptyNodeDriverPlugin],
  })

  await esbuild.build({
    entryPoints: ["api/_makers.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    outfile: "cloud-functions/[[default]].js",
    minify: true,
    format: "esm",
    external: ["ssh2", "cpu-features", "iconv-lite", "mysql2"],
    loader: { ".html": "text", ".node": "empty" },
    plugins: [emptyNodeDriverPlugin, normalizeHtmlEolPlugin],
  })

  if (fs.existsSync("esa-entry.ts")) {
    await esbuild.build({
      entryPoints: ["esa-entry.ts"],
      bundle: true,
      platform: "neutral",
      outfile: "dist/esa-entry.js",
      minify: true,
      format: "esm",
      mainFields: ["module", "main"],
      external: ["ssh2", "cpu-features", "iconv-lite", "mysql2", "node:*"],
      loader: { ".html": "text", ".node": "empty" },
      plugins: [emptyNodeDriverPlugin, normalizeHtmlEolPlugin],
    })
  }

  console.log(
    "✓ Edge build complete -> dist-server/api/[...route].js & cloud-functions/[[default]].js",
  )
}

build().catch((err) => {
  console.error(err)
  process.exit(1)
})
