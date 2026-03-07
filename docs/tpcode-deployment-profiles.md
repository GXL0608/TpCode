# TpCode Deployment Profiles

This document standardizes local, test, and production configuration profiles for TpCode gateway behavior.

## Common environment

```bash
export OPENCODE_CONFIG_DIR=/etc/tpcode
export TPCODE_ACCOUNT_ENABLED=1
export TPCODE_ACCOUNT_JWT_SECRET='replace-with-strong-secret'
export TPCODE_ADMIN_PASSWORD='replace-with-strong-password'
export TPCODE_GATEWAY_NODE_ID="$(hostname -I | awk '{print $1}'):4096"
```

## Local profile (no load balancing)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "server": {
    "hostname": "127.0.0.1",
    "port": 4096,
    "gateway": {
      "enabled": false,
      "webEnabled": false
    }
  },
  "TPCODE_ACCOUNT_ENABLED": true,
  "TPCODE_REGISTER_MODE": "open"
}
```

Start:

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

## Test profile (through test gateway)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "server": {
    "hostname": "0.0.0.0",
    "port": 4096,
    "cors": ["https://tpcode-test.xxx"],
    "gateway": {
      "enabled": true,
      "drain": false,
      "maxWriteInflight": 64,
      "rejectWriteOnOverload": true,
      "webEnabled": true,
      "webUrl": "https://tpcode-test.xxx"
    }
  },
  "TPCODE_ACCOUNT_ENABLED": true,
  "TPCODE_REGISTER_MODE": "open"
}
```

Start:

```bash
opencode serve --hostname 0.0.0.0 --port 4096
```

## Production profile (through production gateway)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "server": {
    "hostname": "0.0.0.0",
    "port": 4096,
    "cors": ["https://tpcode.xxx"],
    "gateway": {
      "enabled": true,
      "drain": false,
      "maxWriteInflight": 128,
      "rejectWriteOnOverload": true,
      "webEnabled": true,
      "webUrl": "https://tpcode.xxx"
    }
  },
  "TPCODE_ACCOUNT_ENABLED": true,
  "TPCODE_REGISTER_MODE": "invite"
}
```

Start:

```bash
opencode serve --hostname 0.0.0.0 --port 4096
```

## Runtime overrides

Force non-LB mode:

```bash
opencode serve --no-gateway-enabled --no-gateway-web-enabled --hostname 0.0.0.0 --port 4096
```

Force LB mode:

```bash
opencode serve --gateway-enabled --gateway-web-enabled --gateway-web-url=https://tpcode.xxx --hostname 0.0.0.0 --port 4096
```
