# Source before npm in the cloud workspace: its bypass list sends the npm
# registry around the proxy, where DNS can't resolve it.
export npm_config_noproxy=localhost,127.0.0.1
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
