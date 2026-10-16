const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");
const config = getDefaultConfig(__dirname);
// Router's context includes explicit .tsx imports during static export. Resolve
// those to their web counterpart so recording/SQLite never enter a web bundle.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === "web" &&
    moduleName.endsWith(".tsx") &&
    !moduleName.endsWith(".web.tsx")
  ) {
    const target = path.resolve(
      path.dirname(context.originModulePath),
      moduleName,
    );
    const web = target.replace(/\.tsx$/, ".web.tsx");
    if (
      target.startsWith(path.join(__dirname, "src", "app") + path.sep) &&
      fs.existsSync(web)
    )
      return { type: "sourceFile", filePath: web };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
