# OpenWrt-Based Wi-Fi Quota Manager

A comprehensive system for managing Wi-Fi network access, monitoring device data usage, enforcing data quotas, and providing network visibility and control through a mobile dashboard.

## Features

### 📊 Network Monitoring & Analytics
- **Real-time Device Tracking**: Monitor all devices connected to the network with details like name, MAC, and IP address.
- **Bandwidth Monitoring**: Track upload and download speeds for each device in real-time.
- **Historical Data Analysis**: View daily, weekly, monthly, and annual usage statistics.
- **Smart Classification**: Automatic device classification based on vendor (e.g., iPhone, Samsung, Dell).

### 💰 Quota & Access Control
- **Per-Device Quotas**: Set monthly data limits (GB) for individual devices.
- **Access Management**: Manually enable or disable internet access for any device.
- **Smart Control (Experimental)**: Automated access control based on usage thresholds.
- **Dynamic Metering**: Automated detection of used quotas and application of block rules using `nftables`.

### 📱 Mobile Dashboard (Flutter)
- **Responsive UI**: Clean and modern interface optimized for mobile.
- **Interactive Analytics**: Visual charts and progress bars for data usage.
- **One-Tap Control**: Simple toggles to manage device access.
- **Secure Access**: Local network-based authentication and secure API keys.

## Getting Started

### Prerequisites
- **OpenWrt Router**: Running OpenWrt firmware (tested on 21.x and later).
- **Router Access**: SSH and LuCI web interface access.
- **Network**: Device must be on the same local network as the OpenWrt router.

### Installation

#### Step 1: Install Dependencies on OpenWrt

SSH into your OpenWrt router and install the required packages:

```bash
upload.sh 
apt install luci-app-statistics libncurses5-compat kmod-sched-core coreutils-stat coreutils-date coreutils-sort coreutils-uniq coreutils-comm coreutils-cut kmod-ipt-offload ip-full -y

chmod 755 /etc/init.d/qos-server.sh

/etc/init.d/qos-server.sh enable

/etc/init.d/qos-server.sh start

# Verify status
/etc/init.d/qos-server.sh status

```

*Note: This script installs `qos-server` on the OpenWrt device. It requires a compatible mobile client (the Flutter app) to function fully.*

#### Step 2: Install the Flutter App

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd openwrt-wifi-quota-manager/flutter_client
   ```

2. **Install dependencies:**
   ```bash
   flutter pub get
   ```

3. **Configure API Access:**
   - In the app, navigate to **Settings**.
   - Set the **Router IP** to your OpenWrt router's IP address (e.g., `[IP_ADDRESS]`).
   - Enter the **API Key** provided by the OpenWrt `qos-server` script (or set a custom one).

4. **Run the app:**
   ```bash
   flutter run
   ```

## Usage

### OpenWrt Configuration
1. Access the LuCI web interface: `http://<router-ip>/`.
2. Navigate to **Network → QoS Server** (if installed via script) or **Services → qos-server** (if installed via package manager).
3. Configure network settings and devices as needed.
4. Ensure the **API Key** is noted for the Flutter app configuration.

### Mobile App Usage
1. Launch the **Wi-Fi Quota Manager** app.
2. Log in using the router's IP and API Key.
3. **Dashboard**: View network overview and real-time bandwidth.
4. **Devices**: Monitor individual device usage and control access.
5. **Analytics**: Review historical data charts and trends.
6. **Settings**: Configure router connection and API settings.

## Technology Stack

### Backend (OpenWrt)
- **OpenWrt**: Custom daemon/service scripts.
- **nftables**: Firewall rules for traffic control.
- **JSON-RPC**: Communication protocol between app and router.
- **shell/Lua**: Scripting for network monitoring and control.

### Frontend (Flutter App)
- **Flutter**: Cross-platform application (Android, Linux, Web).
- **Riverpod 2.x**: State management and dependency injection.
- **Isar Database**: High-speed offline-first NoSQL database for telemetry snapshots & cache.
- **shared_preferences**: Fast persistent connection & app configurations.
- **Dio**: HTTP client with Bearer Token interceptors and error mappings.
- **fl_chart**: Interactive time-series bandwidth analytics charts.

## Project Structure

```
openwrt-wifi-quota-manager/
├── openwrt/                # OpenWrt router subsystem
│   ├── config/             # devices.json & quota configuration
│   ├── scripts/            # check_quota.py, usage_manager.py, device_manager.py
│   ├── nftables/           # rules.nft firewall rules
│   └── api/                # REST API specification
└── flutter_client/         # Clean Architecture Flutter application
    ├── lib/
    │   ├── core/           # Constants, Theme, Errors, Storage (Isar/Prefs), Network (Dio)
    │   ├── features/       # Feature-First Architecture
    │   │   ├── dashboard/  # ISP Gauge, Top Consumers, Network Metrics
    │   │   ├── devices/    # Device List, Search/Filter, Block Toggle, Adjust Quota
    │   │   ├── analytics/  # 7-Day Usage Charts backed by Isar DB
    │   │   ├── settings/   # Router IP/Port, API Key, Demo Mode, Polling Rate
    │   │   └── shell/      # Bottom Navigation Bar Shell
    │   ├── app.dart        # MaterialApp & Dark Theme
    │   └── main.dart       # Storage initializers & ProviderScope
    └── pubspec.yaml        # Dependencies
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **OpenWrt** - Powerful open-source router firmware.
- **Flutter** - UI toolkit for building natively compiled applications.
