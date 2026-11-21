# Private ChatGPT connectivity

Reviewed 2026-11-20. This procedure is documented, not yet connected or verified against the user's ChatGPT account. It requires explicit approval before creating an external integration or sending Garmin data to ChatGPT. The pre-existing mail Tailscale Funnel is unrelated; do not add Garmin to that public tunnel.

Use [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), which supports private HTTP or stdio MCP servers through an outbound HTTPS client. This adapter uses Streamable HTTP at `http://127.0.0.1:8091/mcp`. No inbound firewall rules, port forwarding, public DNS, TLS certificate or rented hosting are needed. Direct localhost URLs cannot be reached by ChatGPT's servers without a supported tunnel.

## Manual account steps after approval

1. Open [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels) in the intended organization. Create/manage requires Tunnels Read + Manage; running/selecting a tunnel requires Read + Use. Obtain a restricted runtime key. Associate the tunnel with both the intended Platform organization and ChatGPT workspace. A personal Platform organization alone does not guarantee visibility in a workspace.
2. Download the supported client from [OpenAI releases](https://github.com/openai/tunnel-client/releases/latest). Check Windows artifact availability for that release; if unavailable, use the documented Docker client while keeping private local connectivity. Do not install a similarly named third-party package.
3. Run `tunnel-client help quickstart` and follow the current HTTP-profile onboarding. Set the MCP URL to `http://127.0.0.1:8091/mcp`. Configure its upstream Authorization header using an environment reference to the local `MCP_AUTH_TOKEN`; never put the literal token in CLI arguments or tracked configuration. Keep the control-plane runtime key in a local environment reference too. Check the release's help for header configuration syntax rather than guessing flags.
4. Run `tunnel-client doctor --profile garmin-local --explain`, then `tunnel-client run --profile garmin-local`. Confirm readiness/polling. Local server and tunnel client must both remain running. A Docker tunnel cannot use host `127.0.0.1`; use an explicitly private Docker network/host bridge configuration reviewed before proceeding.
5. In [ChatGPT Plugins](https://chatgpt.com/plugins), choose **+ -> Add custom MCP server**, name it Garmin, select **Connection: Tunnel**, then the matching tunnel or tunnel ID. Configure the MCP bearer authentication if the UI supports it; otherwise have the private tunnel attach it upstream. Never choose no-auth against a server that still expects a token. Review the warning, create the plugin, and scan tools.
6. In a new chat select Garmin, then test `garmin_search_activities` with limit 1 after live access is approved. Verify the real result before declaring the connection complete.

## Authentication and permissions

Local bearer authentication is independent of Garmin's Personal API key and the tunnel's control-plane key. The Garmin key never belongs in ChatGPT. Upstream OAuth remains available using a separately generated `MCP_OAUTH_CLIENT_SECRET` and client ID `garmin-mcp`; this is an alternative to upstream bearer injection, not required for the local-only test. Browser-facing OAuth through a private tunnel must be verified with the supported client's discovery forwarding; do not expose the server to make it work without approval.

Current [ChatGPT custom MCP documentation](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) describes plugin creation without a separate developer-mode toggle; legacy interfaces may still show Apps/Create or developer mode. Business requires admin/owner creation rights; Enterprise/Edu can grant creation permissions through RBAC. Pro read/fetch access is described, while actual availability remains account/workspace dependent. Read-only tools do not imply account entitlement.

## Costs and limits

The adapter and local Docker/Node runtime introduce no hosting subscription or model/API calls of their own. MIT software is free to use. Garmin documents personal use rather than commercial multi-user access; verify the account's key creation terms. OpenAI's tunnel guide does not establish a universal standalone tunnel price, so no zero-cost guarantee is made. Verify billing/plan entitlements in Platform before enabling it. Responses API use would incur applicable model usage charges; this implementation does not invoke that API.

The tunnel documents a 120-second overall request deadline and a 10 MiB envelope cap. Adapter response caps are smaller. Tool discovery requires the private server and polling client to be healthy. If the tunnel is not listed, verify its workspace association and Tunnels Read + Use permissions. Do not fall back to public Funnel or paid hosting without explicit approval.
