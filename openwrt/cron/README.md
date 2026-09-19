# Periodic Execution Subsystem (`openwrt/cron/`)

This directory contains the crontab configuration for running the quota enforcement engine periodically on OpenWrt routers.

---

## ⏱ Execution Cycle (Every 1 Minute)

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
(evaluate warnings)    (record in drop set)
```

---

## ⚙ Crontab Configuration

The file `quota-manager.cron` defines the scheduled execution:

```crontab
# OpenWrt Wi-Fi Quota Manager Crontab Schedule
# Run quota evaluation and firewall enforcement audit every 1 minute
* * * * * /usr/bin/python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/check_quota.py >> /var/log/quota_manager.log 2>&1
```

### Installation into Router Crontab
The automated installer `install.sh` handles this automatically. To configure it manually:

```bash
# Add cron job to root's crontab:
echo "* * * * * /usr/bin/python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/check_quota.py >> /var/log/quota_manager.log 2>&1" >> /etc/crontabs/root

# Enable and start the BusyBox cron daemon:
/etc/init.d/cron enable
/etc/init.d/cron restart
```

---

## 💾 RAM-Based Log Inspection

On OpenWrt, `/var/log/` is a symbolic link to `/tmp/`, which resides entirely in volatile RAM (`tmpfs`). This architecture guarantees that writing logs every minute causes **zero wear** on the router's physical flash storage chips.

To inspect execution in real-time:
```bash
tail -f /var/log/quota_manager.log
```
