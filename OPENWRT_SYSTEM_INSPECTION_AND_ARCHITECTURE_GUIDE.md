# 📘 الدليل الشامل لفحص واختبار OpenWrt وتوثيق معمارية نظام إدارة الكوتا (OpenWrt Wi-Fi Quota Manager)

---

## 📑 فهرس المحتويات
1. [نظرة عامة على المشروع وما تم إنجازه](#1-نظرة-عامة-على-المشروع-وما-تم-إنجازه)
2. [المخططات المعمارية الشاملة (Architectural Diagrams)](#2-المخططات-المعمارية-الشاملة-architectural-diagrams)
   - [المخطط العام للنظام بالكامل (End-to-End System)](#21-المخطط-العام-للنظام-بالكامل-end-to-end-system)
   - [معمارية نظام OpenWrt الداخلي وتدفق البيانات](#22-معمارية-نظام-openwrt-الداخلي-وتدفق-البيانات)
   - [مخطط أمان الجدار الناري وحماية الإدارة (Firewall Safety)](#23-مخطط-أمان-الجدار-الناري-وحماية-الإدارة-firewall-safety)
   - [مخطط دورة فحص الكوتا والحظر التلقائي (Enforcement Lifecycle)](#24-مخطط-دورة-فحص-الكوتا-والحظر-التلقائي-enforcement-lifecycle)
   - [مخطط المواءمة الذاتية واستعادة الاتصال (Reconciliation & Healing)](#25-مخطط-المواءمة-الذاتية-واستعادة-الاتصال-reconciliation--healing)
3. [أكواد وأوامر الترمنل لفحص كل صغيرة وكبيرة في OpenWrt](#3-أكواد-وأوامر-الترمنل-لفحص-كل-صغيرة-وكبيرة-في-openwrt)
   - [المجموعة 1: أوامر الاتصال وفحص حالة نظام الراوتر والعتاد](#31-المجموعة-1-أوامر-الاتصال-وفحص-حالة-نظام-الراوتر-والعتاد)
   - [المجموعة 2: فحص الحزم والخدمات المثبتة (Dependencies & Packages)](#32-المجموعة-2-فحص-الحزم-والخدمات-المثبتة-dependencies--packages)
   - [المجموعة 3: فحص مراقبة استهلاك الباندويث (nlbwmon & ubus)](#33-المجموعة-3-فحص-مراقبة-استهلاك-الباندويث-nlbwmon--ubus)
   - [المجموعة 4: فحص جدول الأجهزة المتصلة وعناوين الـ MAC و DHCP](#34-المجموعة-4-فحص-جدول-الأجهزة-المتصلة-وعناوين-الـ-mac-و-dhcp)
   - [المجموعة 5: فحص الجدار الناري وجداول nftables بدقة](#35-المجموعة-5-فحص-الجدار-الناري-وجداول-nftables-بدقة)
   - [المجموعة 6: فحص سكريبتات وخدمات البايثون في الراوتر](#36-المجموعة-6-فحص-سكريبتات-وخدمات-البايثون-في-الراوتر)
   - [المجموعة 7: فحص واختبار REST API المحلي في الراوتر (Port 8080)](#37-المجموعة-7-فحص-واختبار-rest-api-المحلي-في-الراوتر-port-8080)
   - [المجموعة 8: فحص سجلات النظام (Syslog & Quota Logs)](#38-المجموعة-8-فحص-سجلات-النظام-syslog--quota-logs)
4. [أكواد وأوامر فحص الكنترولر المركزي (OpenWrt Controller - Port 3000/3001)](#4-أكواد-وأوامر-فحص-الكنترولر-المركزي-openwrt-controller---port-30003001)
   - [فحص الـ Health والـ Readiness](#41-فحص-الـ-health-والـ-readiness)
   - [فحص مقاييس الأداء والمراقبة (Prometheus & JSON Metrics)](#42-فحص-مقاييس-الأداء-والمراقبة-prometheus--json-metrics)
   - [فحص وإدارة الكوتا والأجهزة عبر API الكنترولر](#43-فحص-وإدارة-الكوتا-والأجهزة-عبر-api-الكنترولر)
   - [استخدام أداة الـ CLI الإدارية (`wifi-controller`)](#44-استخدام-أداة-الـ-cli-الإدارية-wifi-controller)
5. [أوامر تشغيل الاختبارات الآلية الشاملة (Automated Test Suites)](#5-أوامر-تشغيل-الاختبارات-الآلية-الشاملة-automated-test-suites)
6. [دليل الصيانة السريعة والتعامل مع الطوارئ (Troubleshooting & Disaster Recovery)](#6-دليل-الصيانة-السريعة-والتعامل-مع-الطوارئ-troubleshooting--disaster-recovery)

---

## 1. نظرة عامة على المشروع وما تم إنجازه

تم بناء نظام متكامل واحترافي لإدارة واحتساب وتطبيق كوتا الإنترنت على أجهزة راوتر **OpenWrt**، ويتكون المشروع من ثلاثة أركان رئيسية تعمل بتناغم تام:

1. **طبقة الراوتر (OpenWrt Subsystem):**
   - مراقبة سريعة وخفيفة للباندويث عبر النواة مباشرة باستخدام `nlbwmon`.
   - جدار ناري عالي الكفاءة مبني على `nftables` يعمل في مسار التوجيه `forward` فقط لمنع أي قطع لإدارة الراوتر.
   - محرك بايثون خفيف مخصص لبيئات الذاكرة المحدودة (بدون أي مكتبات خارجية ثقيلة) لإدارة الأجهزة وفحص الكوتا وإرسال التنبيهات (80%, 90%, 95%, 100%).
   - خادم REST API داخلي مدمج يعمل على المنفذ `8080` مع توثيق Bearer Token.
   - خدمة تلقائية عبر نظام الإشراف `procd` وجدولة زمنية كل دقيقة عبر `cron`.

2. **طبقة الكنترولر المتقدم (OpenWrt Controller Backend - Node.js/TypeScript):**
   - معمارية برمجية نقية (Clean Architecture) تفصل بين منطق العمل (Domain)، البنية التحتية (Infrastructure)، وواجهات برمجة التطبيقات (API).
   - محرك مواءمة ذاتية فائق الذكاء (Self-Healing Reconciliation Engine) يعيد حظر الأجهزة المستنفذة للكوتا تلقائياً حتى لو تمت إعادة تشغيل الراوتر أو تم مسح الجدار الناري يدوياً.
   - قاطع دائرة حرج (Circuit Breaker) لحماية النظام عند انقطاع الراوتر واستعادة الاتصال تلقائياً.
   - نظام حماية صارم يمنع حظر عنوان الـ MAC للراوتر نفسه أو كروت الجسر (Bridge MACs) نهائياً.
   - مراقبة إنتاجية كاملة تدعم Prometheus Metrics ولوحات تحكم Grafana وسجلات تفصيلية عبر Pino.
   - أداة سطر أوامر إدارية سريعة `wifi-controller` وحزم نشر عبر Docker و systemd.

3. **تطبيق الموبايل (Flutter Cross-Platform Client):**
   - لوحة تحكم عصرية تعرض الاستهلاك الفعلي، السرعات الحالية، والكوتا المتبقية بدقة.
   - شاشة لإدارة الأجهزة مع إمكانية الحظر اليدوي وتحديد كوتا مخصصة لكل جهاز بالجيجابايت.
   - نظام اتصالات مباشر مع الراوتر أو الكنترولر مع دعم التشفير والوضع التجريبي (Demo Mode).

---

## 2. المخططات المعمارية الشاملة (Architectural Diagrams)

### 2.1 المخطط العام للنظام بالكامل (End-to-End System)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           1. المستخدم والتطبيقات                           │
│                                                                             │
│     ┌────────────────────────┐                  ┌──────────────────────┐    │
│     │   Flutter Mobile App   │                  │  Admin CLI Terminal  │    │
│     │ (Dashboard & Controls) │                  │  (wifi-controller)   │    │
│     └───────────┬────────────┘                  └──────────┬───────────┘    │
└─────────────────┼──────────────────────────────────────────┼────────────────┘
                  │                                          │
                  │ HTTPS / JSON                             │ REST API
                  ▼                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│             2. الكنترولر المركزي المتقدم (Backend Controller)               │
│                       Fastify / TypeScript (Port 3000)                      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Security Layer: Rate Limiting • Bearer Auth • Zod Schema Validation   │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
│                                     │                                       │
│  ┌──────────────────────────────────┴────────────────────────────────────┐  │
│  │ Core Domain Engine:                                                   │  │
│  │  • Quota Reconciliation Engine (Scenarios A, B, C, D)                 │  │
│  │  • Circuit Breaker (Closed ──> Open ──> Half-Open)                    │  │
│  │  • Device Whitelist & Router MAC Protection Guard                     │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
│                                     │                                       │
│  ┌──────────────────────────────────┴────────────────────────────────────┐  │
│  │ Observability Engine:                                                 │  │
│  │  • /health/live & /health/ready  • Prometheus /metrics  • Pino Logs   │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │
                                      │ SSH / ubus RPC / JSON API
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        3. راوتر OpenWrt (OpenWrt Router)                    │
│                                                                             │
│  ┌───────────────────────────┐                ┌──────────────────────────┐  │
│  │    Traffic Accounting     │                │   DHCP / DNS Subsystem   │  │
│  │   nlbwmon (Kernel Sockets)│                │  dnsmasq (/tmp/dhcp.leases)││
│  └─────────────┬─────────────┘                └────────────┬─────────────┘  │
│                │ (ubus query)                              │ (ARP / Leases) │
│                ▼                                           ▼                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     OpenWrt Python Subsystem                          │  │
│  │   • usage_manager.py (حساب الميجابايت بدقة)                            │  │
│  │   • device_manager.py (اكتشاف الأجهزة والـ Hostnames)                 │  │
│  │   • check_quota.py (فحص نسب الكوتا 80%, 90%, 95%, 100%)               │  │
│  │   • api_usage.py (خادم REST API المحلي على بورت 8080)                 │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
│                                     │                                       │
│                                     │ nftables commands                     │
│                                     ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     Kernel nftables (fw4 Isolated)                    │  │
│  │        table inet quota_manager / quota_enforcement                   │  │
│  │        set blocked_devices { type ether_addr; }                       │  │
│  │        hook forward priority -5 / -10 ──> DROP Internet Traffic       │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │    🌐 WAN / الإنترنت      │
                        │ (الأجهزة المحظورة تُمنع)  │
                        └───────────────────────────┘
```

---

### 2.2 معمارية نظام OpenWrt الداخلي وتدفق البيانات

```mermaid
graph TD
    subgraph Router_Kernel ["نواة نظام لينكس على الراوتر (Linux Kernel)"]
        NL[Netlink Socket / Packet Counters]
        NFT[nftables: table inet quota_manager]
        SET[Set: blocked_devices MACs]
        NFT -->|قاعدة الفحص| SET
    end

    subgraph Monitoring ["طبقة رصد الاستهلاك"]
        NLB[nlbwmon Daemon]
        NL -->|تجميع العدادات| NLB
        UBUS[OpenWrt ubus RPC Bus]
        NLB -->|تسجيل الخدمة| UBUS
    end

    subgraph Discovery ["طبقة اكتشاف الأجهزة"]
        DNSM[dnsmasq /tmp/dhcp.leases]
        ARP[/proc/net/arp]
        DEV_MGR[device_manager.py]
        DNSM --> DEV_MGR
        ARP --> DEV_MGR
    end

    subgraph Core_Engine ["محرك الكوتا وقرارات الحظر"]
        USAGE_MGR[usage_manager.py]
        UBUS -->|ubus call nlbwmon query| USAGE_MGR
        CHECK_Q[check_quota.py]
        USAGE_MGR -->|بيانات الاستهلاك بالبايت| CHECK_Q
        DEV_MGR -->|قائمة الأجهزة وحدود الكوتا| CHECK_Q
    end

    subgraph Enforcement ["طبقة التطبيق والتنفيذ"]
        CHECK_Q -->|تجاوز 100%| BLOCK[إضافة MAC إلى set]
        BLOCK -->|nft add element| SET
        CHECK_Q -->|شحن أو تصفير الكوتا| UNBLOCK[حذف MAC من set]
        UNBLOCK -->|nft delete element| SET
    end

    subgraph Local_API ["خادم API المحلي (Port 8080)"]
        REST[api_usage.py]
        REST --> DEV_MGR
        REST --> USAGE_MGR
        REST --> CHECK_Q
    end
```

---

### 2.3 مخطط أمان الجدار الناري وحماية الإدارة (Firewall Safety)

> [!IMPORTANT]
> **ضمان عدم انقطاع الإدارة نهائياً**:
> تم تصميم قواعد الجدار الناري لترتبط فقط بسلسلة التوجيه العابر (`forward chain`)، ولا ترتبط نهائياً بسلسلة الدخول للراوتر (`input chain`). هذا يضمن أن الجهاز المحظور يستطيع دائماً فتح صفحة الراوتر أو الاتصال بالـ API أو استخدام الـ DNS/DHCP، ولكنه لا يستطيع العبور إلى الإنترنت الخارجي.

```text
                                  حزمة واردة من جهاز متصل (LAN Client Packet)
                                                       │
                                                       ▼
                                            ┌─────────────────────┐
                                            │ مسار الحزمة بالراوتر│
                                            └──────────┬──────────┘
                                                       │
                           ┌───────────────────────────┴───────────────────────────┐
                           │                                                       │
          [الوجهة: الراوتر نفسه (192.168.1.1)]                  [الوجهة: موقع خارجي على الإنترنت (WAN)]
                           │                                                       │
                           ▼                                                       ▼
                ┌─────────────────────┐                                 ┌─────────────────────┐
                │     Input Chain     │                                 │    Forward Chain    │
                └──────────┬──────────┘                                 └──────────┬──────────┘
                           │                                                       │
               قواعد الجدار الناري العادية                             قواعد كوتا المانجر (Priority -5)
                 (OpenWrt fw4 Normal)                              inet quota_manager / forward_quota
                           │                                                       │
            ┌──────────────┴──────────────┐                                        ▼
            ▼                             ▼                             ┌─────────────────────┐
   [منافذ الإدارة مسموحة]       [خدمات الشبكة مسموحة]                   │ هل الـ MAC محظور؟   │
    • SSH (Port 22)               • DNS (Port 53)                       └──────────┬──────────┘
    • LuCI Web (Port 80/443)      • DHCP (Port 67)                                 │
    • Quota API (Port 8080)       • Ping (ICMP)                            ┌───────┴───────┐
            │                             │                                ▼               ▼
            └──────────────┬──────────────┘                              [ نعم ]        [ لا ]
                           │                                               │               │
                           ▼                                               ▼               ▼
                 ✅ مسموح بالدخول دائماً                              ❌ إسقاط الحزمة   ✅ تمرير
                 (مستحيل حظر المدير)                                    (DROP)        (ACCEPT)
```

---

### 2.4 مخطط دورة فحص الكوتا والحظر التلقائي (Enforcement Lifecycle)

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Cron Job (/etc/crontabs/root)
    participant Engine as check_quota.py
    participant Usage as usage_manager.py
    participant Kernel as nlbwmon / ubus
    participant NFT as nftables (blocked_devices)
    participant Log as /var/log/quota_manager.log

    Note over Cron: كل 60 ثانية (دقيقة)
    Cron->>Engine: تشغيل فحص الكوتا الدوري
    Engine->>Usage: استدعاء بيانات الاستهلاك لكل MAC
    Usage->>Kernel: ubus call nlbwmon query (JSON)
    Kernel-->>Usage: مصفوفة الاستهلاك (RX/TX Bytes)
    Usage-->>Engine: استهلاك الأجهزة المحسوب بدقة
    
    loop لكل جهاز مسجل
        Engine->>Engine: حساب النسبة = (المستهلك / الكوتا) * 100
        alt النسبة بين 80% و 99%
            Engine->>Log: تسجيل تحذير (مع منع التكرار Warning Deduplication)
        else النسبة >= 100% (استنفاد الكوتا)
            Engine->>NFT: nft add element inet quota_manager blocked_devices { MAC }
            NFT-->>Engine: تم تحديث النواة (Dropped)
            Engine->>Log: تسجيل حدث الحظر الفوري (EXHAUSTED & BLOCKED)
        else الكوتا مشحونة والـ MAC محظور
            Engine->>NFT: nft delete element inet quota_manager blocked_devices { MAC }
            NFT-->>Engine: تم رفع الحظر (Restored)
            Engine->>Log: تسجيل حدث فك الحظر (QUOTA RESTORED)
        end
    end
```

---

### 2.5 مخطط المواءمة الذاتية واستعادة الاتصال (Reconciliation & Healing)

يوضح هذا المخطط كيفية تعامل الكنترولر مع حالات فقدان الاتصال، أو إعادة تشغيل الراوتر، أو مسح الجدار الناري يدوياً:

```mermaid
stateDiagram-v2
    [*] --> Closed_Normal: النظام يعمل بشكل طبيعي
    
    state Closed_Normal {
        [*] --> PeriodicSync
        PeriodicSync --> CompareState: مطابقة حالة التخزين مع حالة الراوتر الحالية
        CompareState --> Scenario_A: ماك مستنفذ غير محظور في nftables
        Scenario_A --> RepairBlock: تنفيذ أمر الحظر فوراً (Auto-Repair)
        CompareState --> Scenario_B: ماك تم تصفير كوتته وما زال محظوراً
        Scenario_B --> RepairUnblock: إزالة الماك فوراً (Auto-Unblock)
        CompareState --> Scenario_C: راوتر أعاد التشغيل وفقد الجداول
        Scenario_C --> RecreateTable: إعادة بناء الجداول ومزامنة كل المحظورين
        CompareState --> Scenario_D: ماك محظور يدوياً من الأدمن
        Scenario_D --> PreserveBlock: حماية الحظر اليدوي من الإزالة
    }

    Closed_Normal --> Open_Breaker: فشل الاتصال بالراوتر (>= 3 محاولات)
    
    state Open_Breaker {
        [*] --> FastFail: إرجاع خطأ فوري وحماية الـ Event Loop
        FastFail --> CooldownWait: انتظار انتهاء فترة التبريد (10 ثواني)
    }

    Open_Breaker --> HalfOpen_Probe: انتهاء التبريد وتجربة مسبار التحقق
    
    state HalfOpen_Probe {
        [*] --> TestPing: فحص أمر تجريبي بسيط (echo/health)
        TestPing --> SuccessProbe: نجاح الاتصال
        TestPing --> FailProbe: فشل الاتصال
    }

    HalfOpen_Probe --> Closed_Normal: نجاح المسبار واستعادة الخدمة
    HalfOpen_Probe --> Open_Breaker: فشل المسبار والعودة للتبريد
```

---

## 3. أكواد وأوامر الترمنل لفحص كل صغيرة وكبيرة في OpenWrt

فيما يلي قائمة شاملة بجميع الأوامر التي يمكنك تنفيذها لفحص واختبار كل عنصر في الراوتر سطر بسطر مع توضيح الناتج المتوقع:

### 3.1 المجموعة 1: أوامر الاتصال وفحص حالة نظام الراوتر والعتاد

#### 1. تسجيل الدخول عبر SSH إلى الراوتر:
```bash
ssh root@192.168.1.1
# أو إذا كان الراوتر على عنوان شبكة مختلف مثل شبكة الاختبار:
ssh root@192.168.50.1
```

#### 2. فحص إصدار نظام OpenWrt والنواة (Kernel):
```bash
uname -a
cat /etc/openwrt_release
```
*الناتج المتوقع:*
```text
DISTRIB_ID='OpenWrt'
DISTRIB_RELEASE='23.05.x' (أو 22.03.x)
Linux OpenWrt 5.15.x ...
```

#### 3. فحص استهلاك الذاكرة العشوائية (RAM):
```bash
free -m
```
*الناتج المتوقع:* وجود ذاكرة كافية شاغرة (المشروع مصمم ليعمل في حدود أقل من 8 ميجابايت إضافية).

#### 4. فحص المساحة التخزينية في ذاكرة الفلاش والـ RAM:
```bash
df -h
```
*التحقق:* تأكد أن `/tmp` (الذي نستخدمه للسجلات والحالات المؤقتة) موجود على `tmpfs` لحماية ذاكرة الفلاش من التلف.

---

### 3.2 المجموعة 2: فحص الحزم والخدمات المثبتة (Dependencies & Packages)

#### 1. التحقق من تثبيت البايثون الأساسي:
```bash
python3 --version
which python3
```
*الناتج المتوقع:* `Python 3.9.x` أو أحدث في المسار `/usr/bin/python3`.

#### 2. التحقق من تثبيت أداة مراقبة الباندويث `nlbwmon`:
```bash
which nlbwmon
which nlbw
```
*الناتج المتوقع:* `/usr/sbin/nlbwmon` و `/usr/sbin/nlbw`.

#### 3. التحقق من تثبيت الجدار الناري الحديث `nftables`:
```bash
nft --version
which nft
```
*الناتج المتوقع:* `nftables v1.0.x` أو `v1.1.x`.

#### 4. أمر تثبيت أي حزمة ناقصة (في حال عدم وجودها):
```bash
opkg update
opkg install python3-base nlbwmon nftables
```

---

### 3.3 المجموعة 3: فحص مراقبة استهلاك الباندويث (nlbwmon & ubus)

#### 1. فحص تشغيل خدمة nlbwmon:
```bash
/etc/init.d/nlbwmon status
ps | grep nlbwmon
```
*الناتج المتوقع:* ظهور معرّف العملية (PID) وأن الخدمة في وضع `running`.

#### 2. فحص تسجيل nlbwmon في ناقل النظام ubus:
```bash
ubus list | grep nlbwmon
```
*الناتج المتوقع:* ظهور `nlbwmon`.

#### 3. جلب بيانات الاستهلاك الحالية بتنسيق JSON مباشرة من ubus:
```bash
ubus call nlbwmon query
# أو لعرض الحقول المتاحة:
ubus -v list nlbwmon
```
*الناتج المتوقع:* كائن JSON يحتوي على مصفوفة الأعمدة `columns` والسجلات `rows` لكل عنوان MAC واستهلاك التحميل (rx_bytes) والرفع (tx_bytes).

#### 4. الاستعلام عن الاستهلاك باستخدام أداة سطر الأوامر `nlbw`:
```bash
# عرض الاستهلاك الحالي بتنسيق جدول مقروء:
nlbw -c display

# عرض الاستهلاك بتنسيق JSON مفصل:
nlbw -c json
```

#### 5. إعادة تشغيل أو تنظيف قاعدة بيانات nlbwmon إذا لزم الأمر:
```bash
/etc/init.d/nlbwmon restart
```

---

### 3.4 المجموعة 4: فحص جدول الأجهزة المتصلة وعناوين الـ MAC و DHCP

#### 1. فحص جدول توزيع الآيبيهات النشطة (DHCP Leases):
```bash
cat /tmp/dhcp.leases
```
*الناتج المتوقع:* قائمة تحتوي على (وقت انتهاء الحجز، عنوان الـ MAC، عنوان الـ IP، اسم الجهاز Hostname).

#### 2. فحص جدول ARP في النواة (Kernel ARP Cache):
```bash
cat /proc/net/arp
```
*الناتج المتوقع:* قائمة بالأجهزة المكتشفة على مستوى الطبقة الثانية في الواجهة `br-lan`.

#### 3. فحص أسماء وعناوين واجهات الشبكة في الراوتر:
```bash
ip -br addr
ip route show
```
*التحقق:* التأكد من وجود الواجهة المحلية `br-lan` وعنوانها (عادة `192.168.1.1` أو `192.168.50.1`).

---

### 3.5 المجموعة 5: فحص الجدار الناري وجداول nftables بدقة

#### 1. فحص جميع الجداول النشطة في الجدار الناري:
```bash
nft list tables
```
*الناتج المتوقع:* ظهور الجداول الأساسية لنظام OpenWrt مثل `table inet fw4`، وظهور الجدول المخصص لنظام الكوتا:
```text
table inet fw4
table inet quota_manager   <-- (أو quota_enforcement)
```

#### 2. استعراض قواعد جدول الكوتا بالكامل:
```bash
nft list table inet quota_manager
# أو إذا تم تفعيله باسم quota_enforcement:
nft list table inet quota_enforcement
```
*الناتج المتوقع:*
```nft
table inet quota_manager {
    set blocked_devices {
        type ether_addr
        flags interval
    }

    chain forward_quota {
        type filter hook forward priority -5; policy accept;
        ether saddr @blocked_devices counter drop
        ether daddr @blocked_devices counter drop
    }
}
```

#### 3. فحص قائمة الأجهزة المحظورة حالياً (Blocked MACs):
```bash
nft list set inet quota_manager blocked_devices
# أو في جدول enforcement:
nft list set inet quota_enforcement blocked_macs
```
*الناتج:* عرض كل عناوين الـ MAC المحظورة داخل الحاصرتين `{ ... }`.

#### 4. تجربة يدوية لإضافة جهاز للاختبار (Manual Block Test):
```bash
# إضافة عنوان MAC تجريبي:
nft add element inet quota_manager blocked_devices '{ 52:54:00:aa:bb:cc }'

# التحقق من إضافته:
nft list set inet quota_manager blocked_devices | grep -i "52:54:00:aa:bb:cc"

# حذفه وفك الحظر عنه:
nft delete element inet quota_manager blocked_devices '{ 52:54:00:aa:bb:cc }'
```

#### 5. التأكد من عدادات الحزم المسقطة (Drop Counters):
```bash
nft list chain inet quota_manager forward_quota
```
*الناتج:* رؤية عدد الحزم (packets) والبايتات (bytes) التي تم حظرها وإسقاطها بواسطة القاعدة.

---

### 3.6 المجموعة 6: فحص سكريبتات وخدمات البايثون في الراوتر

#### 1. فحص ملفات المشروع في مجلد التثبيت داخل الراوتر:
```bash
ls -la /root/openwrt-wifi-quota-manager/openwrt/
ls -la /root/openwrt-wifi-quota-manager/openwrt/scripts/
```
*الملفات الأساسية التي يجب أن تجدها:*
- `scripts/usage_manager.py`
- `scripts/device_manager.py`
- `scripts/check_quota.py`
- `api/api_usage.py`
- `services/quota-manager.init`
- `config/devices.json`

#### 2. فحص حالة خدمة البايثون المشرفة بواسطة `procd`:
```bash
/etc/init.d/quota-manager status
ps | grep api_usage.py
```
*الناتج المتوقع:* ظهور عملية البايثون نشطة (running) مع رقم الـ PID.

#### 3. تشغيل فحص الكوتا يدوياً وتتبع المخرجات في الترمنل:
```bash
python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/check_quota.py
```
*الناتج المتوقع:* تقرير فوري يوضح فحص كل جهاز مسجل، استهلاكه الحالي، النسبة المئوية للكوتا، والإجراء المتخذ (PASS / WARNING / BLOCKED).

#### 4. فحص الجدولة التلقائية في Crontab:
```bash
cat /etc/crontabs/root
```
*الناتج المتوقع:*
```text
* * * * * python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/check_quota.py
```

#### 5. تشغيل المحاكي لاختبار كامل السيناريوهات دون الحاجة لأجهزة حقيقية:
```bash
python3 /root/openwrt-wifi-quota-manager/openwrt/scripts/simulate.py
```
*الناتج:* تشغيل دورة تجريبية من 4 مراحل (اكتشاف جهاز -> استهلاك خفيف -> تحذير عند 80% -> استنفاد الكوتا والحظر عند 100%).

---

### 3.7 المجموعة 7: فحص واختبار REST API المحلي في الراوتر (Port 8080)

#### 1. فحص جاهزية نقطة الـ Health:
```bash
curl -i http://127.0.0.1:8080/health
```
*الناتج المتوقع (HTTP 200 OK):*
```json
{
  "status": "ok",
  "service": "OpenWrt Wi-Fi Quota Manager API",
  "version": "1.0.0"
}
```

#### 2. جلب قائمة الأجهزة المتصلة والمستهلكة:
```bash
curl -s -H "Authorization: Bearer openwrt-secret-token-2026" http://127.0.0.1:8080/devices | jsonfilter -e '@' 2>/dev/null || curl -s http://127.0.0.1:8080/devices
```

#### 3. جلب تقرير الاستهلاك العام:
```bash
curl -s http://127.0.0.1:8080/reports
```

#### 4. إضافة أو تحديث جهاز وتعيين كوتا 5 جيجابايت له:
```bash
curl -s -X POST http://127.0.0.1:8080/devices \
  -H "Content-Type: application/json" \
  -d '{"mac": "52:54:00:12:34:56", "name": "Phone-Ibrahim", "quota_gb": 5.0, "is_active": true}'
```

#### 5. فحص قائمة الأجهزة المحظورة عبر الـ API:
```bash
curl -s http://127.0.0.1:8080/blocked
```

---

### 3.8 المجموعة 8: فحص سجلات النظام (Syslog & Quota Logs)

#### 1. قراءة سجلات نظام الكوتا المباشرة في RAM:
```bash
cat /var/log/quota_manager.log
# أو متابعة السجلات لحظة بلحظة:
tail -f /var/log/quota_manager.log
```

#### 2. فحص سجلات نظام OpenWrt العامة (logread):
```bash
logread | grep -i quota
logread | grep -i nlbwmon
```

#### 3. فحص ملف حالة التحذيرات المخزن مؤقتاً:
```bash
cat /tmp/quota_warning_state.json 2>/dev/null || echo "No active warnings yet"
```

---

## 4. أكواد وأوامر فحص الكنترولر المركزي (OpenWrt Controller - Port 3000/3001)

إذا كنت تقوم بتشغيل خادم الكنترولر المركزي (`openwrt-controller`) على جهاز السيرفر أو جهاز التطوير، فإليك أوامر الفحص الدقيقة:

### 4.1 فحص الـ Health والـ Readiness
```bash
# فحص الحالة العامة
curl -s http://127.0.0.1:3000/api/health

# فحص Liveness Probe (للتأكد أن الخدمة حية):
curl -s http://127.0.0.1:3000/health/live
# الناتج المتوقع: {"status":"alive","timestamp":"..."}

# فحص Readiness Probe (للتأكد من جاهزية الاتصال بالراوتر والتخزين):
curl -s http://127.0.0.1:3000/health/ready
# الناتج المتوقع: {"status":"ready","ready":true,"checks":{...}}
```

---

### 4.2 فحص مقاييس الأداء والمراقبة (Prometheus & JSON Metrics)
```bash
# جلب مقاييس بروميثيوس بصيغة النص القياسية:
curl -s http://127.0.0.1:3000/metrics | grep "http_requests_total"

# جلب تقرير المقاييس المصنف بتنسيق JSON:
curl -s http://127.0.0.1:3000/api/metrics

# فحص التقرير التشغيلي الكامل وتيليمتري الكنترولر:
curl -s http://127.0.0.1:3000/api/operations/status
```

---

### 4.3 فحص وإدارة الكوتا والأجهزة عبر API الكنترولر
```bash
# عرض كوتا جميع الأجهزة وحالة الاستهلاك الحالية:
curl -s http://127.0.0.1:3000/api/quotas

# عرض حالة مراقب الكوتا الدوري (Quota Enforcement Monitor):
curl -s http://127.0.0.1:3000/api/quota-enforcement/status

# عرض الأجهزة المحظورة حالياً في الجدار الناري:
curl -s http://127.0.0.1:3000/api/firewall/blocked

# اختبار محاولة حظر عنوان الـ MAC الخاص بالراوتر (يجب أن يفشل تلقائياً للأمان):
curl -s -X POST http://127.0.0.1:3000/api/firewall/block \
  -H "Content-Type: application/json" \
  -d '{"mac": "52:54:00:CF:15:77"}'
# الناتج المتوقع: رفض العملية بخطأ InfrastructureDeviceError لمنع انقطاع الراوتر
```

---

### 4.4 استخدام أداة الـ CLI الإدارية (`wifi-controller`)
توفر الأداة المدمجة طريقة سريعة ومباشرة للتحكم من سطر الأوامر دون كتابة أوامر curl طويلة:

```bash
# التوجه لمجلد الكنترولر:
cd "openwrt-controller"

# عرض المساعدة والأوامر المتاحة:
./bin/wifi-controller.js --help

# فحص حالة النظام والاتصال:
./bin/wifi-controller.js status

# عرض قائمة الأجهزة واستهلاكها:
./bin/wifi-controller.js devices

# عرض الأجهزة المحظورة:
./bin/wifi-controller.js blocked

# حظر جهاز يدوياً بواسطة الـ MAC:
./bin/wifi-controller.js block 52:54:00:AA:BB:CC --reason "Admin policy"

# فك الحظر عن جهاز:
./bin/wifi-controller.js unblock 52:54:00:AA:BB:CC

# تعديل كوتا جهاز إلى 10 جيجابايت مع تصفير الاستهلاك القديم:
./bin/wifi-controller.js quota set 52:54:00:12:34:56 --bytes 10737418240 --reset-usage
```

---

## 5. أوامر تشغيل الاختبارات الآلية الشاملة (Automated Test Suites)

للتأكد من سلامة النظام 100%، يمكنك تنفيذ الاختبارات الآلية المدمجة في المشروع بضغطة زر:

### 1. تشغيل الفحص الآلي الشامل لدمج الراوتر (8 مراحل كاملة):
يختبر هذا السكريبت: الاتصال، عزل الجداول، عمل الكنترولر، محاكاة استنفاد الكوتا، حذف الجدول يدوياً واستعادته تلقائياً، أمان حماية الماك الخاص بالراوتر، وفصل الإنترنت عن الشبكة الداخلية:

```bash
cd "/home/ibrahim-elshishtawy/flutter project/openwrt-wifi-quota-manager"
./verify-openwrt-integration.sh
```
*الناتج النهائي المتوقع:*
```text
========================================================================
  Verification Summary
========================================================================
Tests Passed: 18
Tests Failed: 0

🎉 ALL INTEGRATION HARDENING & RECOVERY CHECKS PASSED!
```

---

### 2. تشغيل اختبارات الـ Unit Tests للكنترولر (31 جناح اختبار كامل):
```bash
cd "openwrt-controller"
npm test
```
*الناتج المتوقع:* نجاح جميع أجنحة الاختبارات بنسبة 100% (31 Passed).

---

### 3. تشغيل اختبارات بايثون على الراوتر (66 اختبار):
```bash
cd "openwrt"
python3 -m unittest discover -s tests -p "test_*.py"
```
*الناتج المتوقع:*
```text
Ran 66 tests in 0.817s
OK
```

---

## 6. دليل الصيانة السريعة والتعامل مع الطوارئ (Troubleshooting & Disaster Recovery)

| العَرَض أو المشكلة | السبب المحتمل | أمر الحل السريع بالترمنل |
| :--- | :--- | :--- |
| **تعذر الوصول للراوتر عبر SSH** | الشبكة غير متصلة أو تم تغيير الآيبي | افحص الاتصال: `ping 192.168.1.1`<br>تأكد من عنوان جهازك: `ip route show` |
| **استهلاك الأجهزة يظهر صفر دائماً (0 MB)** | خدمة `nlbwmon` متوقفة أو لم تُنشئ قاعدة بياناتها | قم بإعادة تشغيلها: `/etc/init.d/nlbwmon restart`<br>وافحص جمع البيانات: `nlbw -c json` |
| **الأجهزة المستنفذة للكوتا لا يتم حظرها** | جدول `nftables` غير محمل في النواة | أعد تحميل القواعد فوراً:<br>`nft -f /root/openwrt-wifi-quota-manager/openwrt/nftables/rules.nft`<br>وتأكد من الـ set:<br>`nft list set inet quota_manager blocked_devices` |
| **خادم API المحلي (8080) متوقف** | تعطل خدمة البايثون في الراوتر | أعد تشغيل الخدمة:<br>`/etc/init.d/quota-manager restart`<br>واقرأ السجل:<br>`tail -n 20 /var/log/quota_manager.log` |
| **فقدان الجداول عند إعادة تشغيل الراوتر (Reboot)** | لم يتم تفعيل خدمة التشغيل التلقائي | فعّل الخدمة لتبدأ مع الإقلاع:<br>`/etc/init.d/quota-manager enable`<br>`/etc/init.d/nlbwmon enable` |
| **الكنترولر في حالة Circuit Breaker OPEN** | الراوتر كان مغلقاً أو SSH معطل مؤقتاً | بعد عودة الراوتر للعمل، سيعود الكنترولر تلقائياً إلى وضع `CLOSED` خلال 10 ثوانٍ بمجرد نجاح مسبار الفحص. |
| **فك الحظر يدوياً عن جهاز في حالة طوارئ** | رغبة المدير في فك الحظر فوراً | على الراوتر مباشرة:<br>`nft delete element inet quota_manager blocked_devices '{ <MAC> }'`<br>أو عبر الكنترولر:<br>`./bin/wifi-controller.js unblock <MAC>` |

---

> 💡 **ملاحظة للمطور والمدير**: تم حفظ هذا التوثيق ليكون مرجعاً تقنياً وهندسياً دائماً، ويمكن طباعته أو تصديره إلى ملفات Word أو PDF ومشاركته مع فريق العمل.
