# Periodic Execution Subsystem (`openwrt/cron/`)

This directory documents the scheduling mechanism for running the quota enforcement engine periodically on OpenWrt routers.

---

## ⏱ Execution Cycle (MVP: Every 1 Minute)

```text
┌──────────────────────────────────────┐
│        Every 1 Minute (cron)         │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  /usr/bin/python3 check_quota.py     │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│       Audit all active devices       │
│    (nlbwmon usage vs quota limit)    │
└──────────────────┬───────────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
    Within Quota       Exceeded Quota
         │                   │
         ▼                   ▼
Ensure Unblocked       Block in nftables
```

---

## ⚙ OpenWrt Crontab Setup

OpenWrt uses BusyBox's `crond` daemon. User crontabs are stored in `/etc/crontabs/root`.

### 1. Configure the Cron Entry

Edit the root crontab on the router:

```bash
crontab -e
```

Add the following line (assuming the repository is placed at `/root/openwrt-wifi-quota-manager`):

```crontab
* * * * * /usr/bin/python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/check_quota.py >> /var/log/quota_manager.log 2>&1
```

> [!TIP]
> **RAM-Based Logging**: On OpenWrt, `/var/log` is a symlink to `/tmp/`, which resides in volatile RAM (`tmpfs`). Writing logs to `/var/log/quota_manager.log` prevents wear and degradation of the router's internal Flash memory chips (NAND/NOR flash).

### 2. Enable and Start the Cron Service

OpenWrt does not enable the cron daemon by default on clean installations:

```bash
# Enable crond service on router startup
/etc/init.d/cron enable

# Start the crond daemon immediately
/etc/init.d/cron start

# Check service status
/etc/init.d/cron status
```

### 3. Log Inspection

Monitor the enforcement execution in real-time via:

```bash
tail -f /var/log/quota_manager.log
```
