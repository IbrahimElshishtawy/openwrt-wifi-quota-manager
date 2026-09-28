# دليل تنفيذ واختبار تكامل واستعادة OpenWrt
## OpenWrt Integration Hardening & Recovery Execution Guide

هذا الدليل يحتوي على جميع الأوامر المرتبة لاختبار النظام خطوة بخطوة والتأكد من نجاح جميع مراحل الـ Integration والـ Recovery.

---

### طريقة التشغيل السريعة (Automated Script)

يمكنك تشغيل الفحص الكامل بضغطة واحدة من مسار المشروع الرئيسي:

```bash
cd "/home/ibrahim-elshishtawy/flutter project/openwrt-wifi-quota-manager"
./verify-openwrt-integration.sh
```

---

## الأوامر مرتبة بالتفصيل خطوة بخطوة (Manual Execution Order)

---

### المرحلة 1 — التحقق من الـ Build واختبارات الـ Unit/Integration

```bash
cd "/home/ibrahim-elshishtawy/flutter project/openwrt-wifi-quota-manager/openwrt-controller"

# 1. بناء المشروع عبر TypeScript
npm run build

# 2. تشغيل كافة الاختبارات (23 Test Suites)
npm test
```

> **النتيجة المتوقعة**:
> - خروج كلا الأمرين بـ `exit code 0` بنجاح كامل بدون أي أخطاء.

---

### المرحلة 2 — فحص حالة راوتر OpenWrt والـ Test Client

```bash
# 1. فحص اتصال الراوتر عبر SSH
ssh root@192.168.50.1 "uname -a"

# 2. فحص اتصال جهاز الاختبار (Test Client VM)
ssh root@192.168.50.50 "uname -a"

# 3. التأكد من عزل جدول الـ quota وعدم لمس جدول fw4 الأساسي
ssh root@192.168.50.1 "nft list tables"

# 4. استعراض جدول inet quota_enforcement
ssh root@192.168.50.1 "nft list table inet quota_enforcement"

# 5. استعراض عناوين الشبكة وجداول التوجيه
ssh root@192.168.50.1 "ip addr"
ssh root@192.168.50.1 "ip route"
ssh root@192.168.50.1 "cat /tmp/dhcp.leases"
ssh root@192.168.50.1 "ip neigh"
```

> **النتيجة المتوقعة**:
> - الراوتر وجهاز الاختبار متاحان عبر SSH.
> - جدول `table inet fw4` سليم تمامًا.
> - جدول `table inet quota_enforcement` يحتوي على set `blocked_macs` و chain `forward_block`.

---

### المرحلة 3 — Baseline Test (مؤشرات الـ Controller)

تأكد من تشغيل الـ Controller:
```bash
cd "/home/ibrahim-elshishtawy/flutter project/openwrt-wifi-quota-manager/openwrt-controller"
node dist/server.js
```

ثم افحص الـ Endpoints:
```bash
# 1. فحص صحة النظام العام
curl -i http://127.0.0.1:3000/api/health

# 2. فحص حالة مراقب الكوتا والتوافق الدوري
curl -i http://127.0.0.1:3000/api/quota-enforcement/status

# 3. استعراض الكوتا الحالية
curl -i http://127.0.0.1:3000/api/quotas

# 4. استعراض الأجهزة المحظورة فعليًا في جدار الحماية
curl -i http://127.0.0.1:3000/api/firewall/blocked
```

> **النتيجة المتوقعة**:
> - استجابة HTTP 200 لجميع الـ Endpoints.
> - `health`: `{"status": "healthy", "circuitBreaker": "CLOSED"}`.
> - `running: true` داخل الـ status.

---

### المرحلة 4 — اختبار استعادة تشغيل الـ Controller (Controller Restart Recovery)

```bash
# 1. التحقق من حظر جهاز الاختبار بسبب نفاد الكوتا
ssh root@192.168.50.1 "nft list set inet quota_enforcement blocked_macs"

# 2. إيقاف الـ Controller
kill $(pgrep -f "dist/server.js")

# 3. التأكد من حفظ البيانات في الملفات
cat "/home/ibrahim-elshishtawy/flutter project/openwrt-wifi-quota-manager/openwrt-controller/data/quotas.json"
cat "/home/ibrahim-elshishtawy/flutter project/openwrt-wifi-quota-manager/openwrt-controller/data/firewall-blocks.json"

# 4. إعادة تشغيل الـ Controller
cd "/home/ibrahim-elshishtawy/flutter project/openwrt-wifi-quota-manager/openwrt-controller"
node dist/server.js &

# 5. التحقق من اكتمال الـ Startup Reconciliation بدون تكرار القواعد
sleep 4
ssh root@192.168.50.1 "nft list table inet quota_enforcement"
```

> **النتيجة المتوقعة**:
> - قراءة الحالة من الملفات واستعادة الـ nftables state بدقة وبدون duplicate rules.

---

### المرحلة 5 — اختبار فقدان واستعادة قواعد nftables (nftables State Loss)

```bash
# السيناريو أ: حذف الجهاز من الـ nftables يدويًا أثناء نفاد الكوتا
ssh root@192.168.50.1 "nft delete element inet quota_enforcement blocked_macs '{ 52:54:00:ce:1c:be }'"

# التأكد من خلو الجدول
ssh root@192.168.50.1 "nft list set inet quota_enforcement blocked_macs"

# الانتظار لدورة توافق واحدة (6 ثوانٍ)
sleep 6

# التحقق من أن الكنترولر أعاد فرض الحظر تلقائيًا
ssh root@192.168.50.1 "nft list set inet quota_enforcement blocked_macs"

# السيناريو ب: تصفير الاستهلاك أو زيادة الكوتا
curl -X PATCH -H "Content-Type: application/json" -d '{"quotaBytes": 1000000000, "resetUsage": true}' http://127.0.0.1:3000/api/quotas/52:54:00:CE:1C:BE

# الانتظار 6 ثوانٍ
sleep 6

# التحقق من حذف الحظر تلقائيًا بعد تجديد الكوتا
ssh root@192.168.50.1 "nft list set inet quota_enforcement blocked_macs"
```

> **النتيجة المتوقعة**:
> - في السيناريو أ: يتم إعادة الحظر فورًا (`Missing block restored`).
> - في السيناريو ب: يتم إزالة الحظر فورًا (`Stale block removed`).

---

### المرحلة 6 — حماية أجهزة البنية التحتية (Router Safety)

```bash
# محاولة حظر ماك الراوتر
curl -i -X POST -H "Content-Type: application/json" -d '{"mac": "52:54:00:CF:15:77"}' http://127.0.0.1:3000/api/firewall/block

# محاولة حظر ماك كرت الشبكة المستضيف (Host Bridge)
curl -i -X POST -H "Content-Type: application/json" -d '{"mac": "52:54:00:5B:2E:C1"}' http://127.0.0.1:3000/api/firewall/block
```

> **النتيجة المتوقعة**:
> - رفض الطلب وإرجاع خطأ `InfrastructureDeviceError` لحماية الوصول الإداري.

---

### المرحلة 7 — عزل شبكة الإنترنت مع بقاء الوصول للشبكة المحلية (LAN vs Internet Isolation)

```bash
# 1. إعادة فرض حظر الكوتا على جهاز الاختبار
curl -X PATCH -H "Content-Type: application/json" -d '{"quotaBytes": 1000, "usedBytes": 5000}' http://127.0.0.1:3000/api/quotas/52:54:00:CE:1C:BE
sleep 6

# 2. تجربة الاتصال بالراوتر محليًا من جهاز الاختبار (يجب أن ينجح 100%)
ssh root@192.168.50.50 "ping -c 2 192.168.50.1"

# 3. التحقق من عداد الـ drops في الـ forward chain
ssh root@192.168.50.1 "nft list chain inet quota_enforcement forward_block"
```

> **النتيجة المتوقعة**:
> - الـ Ping إلى `192.168.50.1` ينجح بدون أي فقد للحزم.
> - حركة المرور المتجهة إلى الخارج تمر بـ `forward_block counter drop` وتُحجب بالكامل.

---

### المرحلة 8 — اختبار إعادة تشغيل راوتر OpenWrt الفعلي (OpenWrt Reboot Recovery)

```bash
# 1. إرسال أمر reboot لراوتر OpenWrt
ssh root@192.168.50.1 "reboot"

# 2. الانتظار حتى يعود الراوتر للعمل
until ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=2 root@192.168.50.1 "echo router_online" 2>/dev/null; do
    echo "Waiting for router reboot..."
    sleep 3
done

# 3. الانتظار لدورة توافق (8 ثوانٍ)
sleep 8

# 4. التأكد من إعادة إنشاء جدول quota_enforcement وإعادة حظر الأجهزة المستنفدة
ssh root@192.168.50.1 "nft list table inet quota_enforcement"
```

> **النتيجة المتوقعة**:
> - بعد إقلاع الراوتر، يقوم الـ Controller بإعادة بناء الجدول واستعادة حظر الأجهزة المستنفدة بدقة وتلقائية تامة.
