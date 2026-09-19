class MockDataGenerator {
  MockDataGenerator._();

  static List<Map<String, dynamic>> mockDevices = [
    {
      "mac": "AA:BB:CC:DD:EE:FF",
      "name": "Ahmed Phone",
      "ip": "192.168.1.150",
      "hostname": "Ahmed-iPhone",
      "usage_gb": 18.2,
      "quota_gb": 20.0,
      "remaining_gb": 1.8,
      "enabled": true,
      "is_blocked": false,
    },
    {
      "mac": "11:22:33:44:55:66",
      "name": "Living Room TV",
      "ip": "192.168.1.120",
      "hostname": "LG-webOS-TV",
      "usage_gb": 48.1,
      "quota_gb": 50.0,
      "remaining_gb": 1.9,
      "enabled": true,
      "is_blocked": false,
    },
    {
      "mac": "66:77:88:99:AA:BB",
      "name": "Guest Laptop",
      "ip": "192.168.1.185",
      "hostname": "ThinkPad-X1",
      "usage_gb": 10.0,
      "quota_gb": 10.0,
      "remaining_gb": 0.0,
      "enabled": false,
      "is_blocked": true,
    },
    {
      "mac": "3C:E5:A6:12:34:56",
      "name": "PlayStation 5",
      "ip": "192.168.1.200",
      "hostname": "PS5-Console",
      "usage_gb": 32.4,
      "quota_gb": 40.0,
      "remaining_gb": 7.6,
      "enabled": true,
      "is_blocked": false,
    },
    {
      "mac": "00:1A:2B:3C:4D:5E",
      "name": "Work MacBook",
      "ip": "192.168.1.110",
      "hostname": "MacBook-Pro",
      "usage_gb": 14.5,
      "quota_gb": 35.0,
      "remaining_gb": 20.5,
      "enabled": true,
      "is_blocked": false,
    },
    {
      "mac": "F4:BD:9E:01:23:45",
      "name": "Smart Security Cam",
      "ip": "192.168.1.240",
      "hostname": "IPC-Outdoor-01",
      "usage_gb": 4.8,
      "quota_gb": 5.0,
      "remaining_gb": 0.2,
      "enabled": true,
      "is_blocked": false,
    },
  ];

  static Map<String, dynamic> mockReport = {
    "status": "success",
    "total_bandwidth_used_gb": 128.0,
    "package_total_gb": 250.0,
    "package_remaining_gb": 122.0,
    "cycle_days_remaining": 11,
    "top_consumers": [
      {"mac": "11:22:33:44:55:66", "name": "Living Room TV", "usage_gb": 48.1},
      {"mac": "3C:E5:A6:12:34:56", "name": "PlayStation 5", "usage_gb": 32.4},
      {"mac": "AA:BB:CC:DD:EE:FF", "name": "Ahmed Phone", "usage_gb": 18.2},
      {"mac": "00:1A:2B:3C:4D:5E", "name": "Work MacBook", "usage_gb": 14.5},
    ]
  };
}
