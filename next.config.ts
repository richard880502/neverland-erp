import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    // Local-upload packagers can omit dot-directories. Keep the public RFC
    // paths while compiling their handlers from a normal application folder.
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/oauth-metadata/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/oauth-metadata/authorization-server" },
    ];
  },
};

export default nextConfig;
