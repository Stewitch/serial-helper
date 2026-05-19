# SerialHelper — 串口烧录+监视器一体化工具 设计方案（定稿）

## 1. 技术栈

| 层 | 选型 | 理由 |
|---|------|------|
| 桌面框架 | **Tauri 2.x** | 体积小(~5MB)、性能高、Rust 后端天然适合硬件操作 |
| 前端 | **React 18 + TypeScript** | 生态丰富、组件化开发、类型安全 |
| 样式 | **Tailwind CSS 3.x** | 原子化样式、暗色/亮色主题切换极简 |
| 状态管理 | **Zustand** | 轻量、TS 友好、无 boilerplate |
| UI 组件 | **Radix UI** (headless) | 无样式组件，搭配 Tailwind 自定义 |
| 国际化 | **react-i18next** | 行业标准、支持命名空间懒加载 |
| 图表(可选) | **Recharts** | 用于将来 DTR/RTS 信号时序等可视化 |
| 串口(后端) | **tokio-serial / serialport-rs** | Rust 异步串口库，跨平台 |
| 烧录协议 | Rust trait 实现 + 外部 CLI 工具调用 | 核心协议内置，复杂协议调用外部工具 |
| 文件解析 | 自研 parser (Rust) | Intel HEX / Motorola SREC / ELF / 纯 bin |
| 打包 | Tauri bundler → .msi / .dmg / .AppImage / .deb |

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      React Frontend                          │
│                                                              │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌──────────┐ │
│  │ Layout   │  │ Theme     │  │ i18n       │  │ Router   │ │
│  │ Shell    │  │ Provider  │  │ Provider   │  │ (react-  │ │
│  │          │  │           │  │            │  │  router) │ │
│  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  └────┬─────┘ │
│       │              │              │              │         │
│  ┌────┴──────────────┴──────────────┴──────────────┴─────┐  │
│  │                   Pages                                 │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────┐   │  │
│  │  │ Monitor    │  │ Flash      │  │ Settings       │   │  │
│  │  │ (主监视器) │  │ (烧录面板) │  │ (设置)         │   │  │
│  │  └────────────┘  └────────────┘  └────────────────┘   │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │ Tauri IPC (invoke + events)       │
├───────────────────────────┼───────────────────────────────────┤
│                      Rust Backend                             │
│                           │                                   │
│  ┌────────────────────────┼──────────────────────────────┐   │
│  │                  App Core (tauri::App)                 │   │
│  │  ┌──────────┐  ┌───────┴──────┐  ┌────────────────┐  │   │
│  │  │ Serial   │  │ Flash        │  │ Tool Manager   │  │   │
│  │  │ Manager  │  │ Orchestrator │  │ (外部工具检测) │  │   │
│  │  └────┬─────┘  └──────┬───────┘  └───────┬────────┘  │   │
│  │       │               │                  │            │   │
│  │  ┌────┴──────┐  ┌─────┴─────────┐  ┌─────┴─────────┐ │   │
│  │  │ Port      │  │ Protocol      │  │ Tool Registry │ │   │
│  │  │ Scanner   │  │ Registry      │  │ (avrdude,     │ │   │
│  │  │ (实时扫描)│  │ (协议注册表)  │  │  esptool...)  │ │   │
│  │  └───────────┘  └─────┬─────────┘  └───────────────┘ │   │
│  │                       │                               │   │
│  │  ┌────────────────────┼───────────────────────────┐   │   │
│  │  │              Protocol Implementations          │   │   │
│  │  │  ┌──────────┐ ┌───────────┐ ┌──────────────┐  │   │   │
│  │  │  │ STM32    │ │ Arduino   │ │ ESP32        │  │   │   │
│  │  │  │ ISP      │ │ AVR       │ │ (esptool)    │  │   │   │
│  │  │  │ Protocol │ │ Protocol  │ │ Protocol     │  │   │   │
│  │  │  └──────────┘ └───────────┘ └──────────────┘  │   │   │
│  │  │  ┌──────────┐ ┌───────────┐ ┌──────────────┐  │   │   │
│  │  │  │ ST-Link  │ │ RP2040    │ │ DFU          │  │   │   │
│  │  │  │ Protocol │ │ Protocol  │ │ Protocol     │  │   │   │
│  │  │  └──────────┘ └───────────┘ └──────────────┘  │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  │                                                       │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │           File Parsers                         │   │   │
│  │  │  Intel HEX  │  Motorola SREC  │  ELF  │  Bin  │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 状态机设计（核心逻辑）

整个应用的生命周期由一个**全局状态机**驱动。这是实现"自动操作"的核心机制。

```
                            ┌───────────────────┐
                            │     STARTING      │
                            │ (启动初始化)       │
                            └────────┬──────────┘
                                     │ 初始化完成
                                     ▼
                     ┌───────────────────────────────┐
                     │           IDLE                │
                     │ (空闲：未连接任何串口)          │
                     └───┬───────────────────────┬───┘
         选择端口+打开     │                       │ 拖入固件文件
                         ▼                       ▼
               ┌─────────────────┐   ┌─────────────────────┐
               │   MONITORING    │   │   READY_TO_FLASH    │
               │ (监视器运行中)   │   │ (已选文件，等待连接) │
               └───┬─────┬───────┘   └──────────┬──────────┘
                   │     │                       │ 点击烧录
     点击烧录       │     │  设备拔出              │
                   │     ▼                       ▼
                   │  ┌──────────┐    ┌──────────────────────┐
                   │  │ PORT_LOST│    │      FLASHING        │
                   │  │ (等待重连)│    │ ┌──────────────────┐ │
                   │  └────┬─────┘    │ │ 1. 关闭监视器串口 │ │
                   │       │ 设备恢复  │ │ 2. 进入bootloader │ │
                   │       ▼          │ │ 3. 擦除 + 写入    │ │
                   │  MONITORING      │ │ 4. 校验           │ │
                   │                  │ │ 5. 复位芯片       │ │
                   │                  │ └──────────────────┘ │
                   │                  └──────────┬───────────┘
                   │                             │
                   │               ┌─────────────┼───────────┐
                   │               │             │           │
                   │           成功 ▼         失败 ▼       取消 ▼
                   │     ┌──────────┐  ┌──────────┐  ┌──────────┐
                   │     │ RESUMING │  │FLASH_ERR │  │  IDLE    │
                   │     │ (重连监视)│  │(显示错误) │  └──────────┘
                   │     └────┬─────┘  └────┬─────┘
                   │          │             │ 用户确认
                   │          ▼             ▼
                   │     MONITORING       IDLE
                   │
                   └─────── 点击断开 ──────► IDLE
```

### 状态转换触发规则

```typescript
// 伪代码：状态转换表
const transitions: Record<AppState, TransitionRule[]> = {
  MONITORING: [
    {
      trigger: 'user_click_flash',
      guard: 'has_flash_file',
      action: ['auto_close_serial', 'release_port', 'enter_flash_mode'],
      target: 'FLASHING',
    },
    {
      trigger: 'port_disconnected',
      action: ['notify_port_lost', 'start_reconnect_timer'],
      target: 'PORT_LOST',
    },
    {
      trigger: 'user_click_disconnect',
      action: ['close_serial'],
      target: 'IDLE',
    },
  ],
  FLASHING: [
    {
      trigger: 'flash_complete',
      guard: 'config.auto_resume_monitor',
      action: ['reopen_serial', 'start_monitor_stream'],
      target: 'RESUMING_MONITOR',
    },
    {
      trigger: 'flash_error',
      action: ['show_error_dialog', 'release_port'],
      target: 'FLASH_ERROR',
    },
  ],
  // ... etc
};
```

### 按键操作规则（状态机保证）

| 场景 | 用户操作 | 系统自动动作 |
|------|---------|-------------|
| 监视器运行中 → 点击烧录 | 选择文件 + 点烧录按钮 | ① 关闭监视器串口 ② 释放端口 ③ 按芯片类型进 bootloader ④ 开始烧录 |
| 烧录完成 | 无（自动） | ① 校验通过 ② 复位芯片 ③ 重新打开串口 ④ 恢复监视器 |
| 烧录进行中 → 点击取消 | 点取消按钮 | ① 尝试安全中断 ② 释放端口 ③ 回到 IDLE |
| 设备意外拔出 | 无（自动检测） | ① 检测端口消失 ② 通知用户 ③ 进入等待重连 ④ 重连后自动恢复监视 |
| 未连接 → 拖入固件 | 拖入/选择文件 | ① 自动解析文件 ② 显示固件信息 ③ 提示连接设备 |
| IDLE → 连接 | 选择端口 + 打开 | ① 打开串口 ② 启动数据流 ③ 进入监视模式 |

---

## 4. 模块/插件系统设计

### 4.1 设计理念

不分"核心模块"和"插件"，**统一用 Module 概念**。区别仅在于：
- **内置 Module**：发布时即包含，无需额外安装
- **可选 Module**：用户按需安装（实际是下载对应的外部工具 + 芯片配置包）

### 4.2 Module 接口定义 (Rust trait)

```rust
/// 烧录协议模块的统一接口
#[async_trait]
pub trait FlashModule: Send + Sync {
    /// 模块唯一标识
    fn module_id(&self) -> &'static str;

    /// 模块名称（用于 UI 显示）
    fn display_name(&self) -> &'static str;

    /// 模块描述
    fn description(&self) -> &'static str;

    /// 支持的芯片列表
    fn supported_chips(&self) -> &[ChipInfo];

    /// 支持的文件格式
    fn supported_formats(&self) -> &[FirmwareFormat];

    /// 外部工具依赖（如 avrdude、esptool）
    fn tool_dependencies(&self) -> &[ToolDependency];

    /// 检查环境是否就绪（依赖工具是否安装）
    async fn check_environment(&self) -> Result<EnvStatus>;

    /// 执行烧录
    async fn flash(
        &self,
        config: FlashConfig,
        firmware: FirmwareData,
        progress: Sender<FlashProgress>,
    ) -> Result<FlashResult>;

    /// 安全取消烧录
    async fn cancel(&self) -> Result<()>;
}
```

### 4.3 内建 Module 清单

```
modules/
├── stm32-isp/          ← 默认内置
│   ├── mod.rs
│   ├── protocol.rs     # STM32 串口 ISP 协议（Rust 实现）
│   ├── chips.rs        # STM32F1/F4/G0/L0/H7... 芯片数据库
│   └── manifest.toml   # 模块元数据
│
├── arduino-avr/        ← 默认内置
│   ├── mod.rs
│   ├── avrdude.rs      # avrdude CLI 封装
│   ├── chips.rs        # ATmega328p/2560/32u4...
│   └── manifest.toml
│
├── stlink/             ← 默认内置（调用 STM32CubeProgrammer CLI 或 OpenOCD）
│   ├── mod.rs
│   ├── cube_prog.rs
│   ├── openocd.rs
│   └── manifest.toml
│
├── dfu/                ← 默认内置（调用 dfu-util）
│   ├── mod.rs
│   ├── dfu_util.rs
│   └── manifest.toml
│
├── esp32/              ← 可选模块
│   ├── mod.rs
│   ├── esptool.rs      # esptool.py 封装
│   └── manifest.toml
│
├── rp2040/             ← 可选模块
│   ├── mod.rs
│   ├── picotool.rs     # picotool 封装
│   └── manifest.toml
│
├── nrf52/              ← 可选模块
│   ├── mod.rs
│   ├── nrfutil.rs      # nrfutil 封装
│   └── manifest.toml
│
└── stm32duino/         ← 可选模块（STM32 跑 Arduino bootloader）
    ├── mod.rs
    ├── dfu_util.rs     # 复用 dfu-util / maple DFU
    └── manifest.toml
```

### 4.4 manifest.toml 示例

```toml
# modules/stm32-isp/manifest.toml
[module]
id = "stm32-isp"
name = "STM32 Serial ISP"
version = "1.0.0"
description = "通过串口 ISP 协议烧录 STM32 系列芯片（需 BOOT0=1）"
builtin = true
category = "arm"

[module.authors]
maintainer = "SerialHelper Team"

# 模块依赖的外部工具
[[tools]]
name = "stm32flash"
display = "stm32flash"
check_cmd = "stm32flash --version"
auto_download = false    # 内置 Rust 实现，无需外部工具

# 支持的芯片
[[chips]]
family = "STM32F1"
variants = ["STM32F103C8", "STM32F103CB", "STM32F103RB", "STM32F103VE", ...]
ram_kb = [20, 20, 20, 48]
flash_kb = [64, 128, 128, 512]
flash_start = "0x08000000"

[[chips]]
family = "STM32F4"
variants = ["STM32F407VG", "STM32F407VE", "STM32F401RE", ...]
ram_kb = [192, 192, 96]
flash_kb = [1024, 512, 512]
flash_start = "0x08000000"

# 支持的文件格式
[[formats]]
id = "hex"
extensions = [".hex", ".ihx"]

[[formats]]
id = "bin"
extensions = [".bin"]
```

### 4.5 前端 Module 管理 UI

```
设置 → 模块管理

┌─────────────────────────────────────────────────────────┐
│  模块管理                                                │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🔌 STM32 Serial ISP              ✓ 已安装 (内建) │    │
│  │    通过串口 ISP 烧录 STM32 全系列芯片              │    │
│  │    支持: STM32F1/F2/F3/F4/F7/G0/G4/H5/H7/L0/L1  │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ 🔌 Arduino AVR                   ✓ 已安装 (内建) │    │
│  │    通过 avrdude 烧录 Arduino AVR 芯片             │    │
│  │    外部工具: avrdude 7.3 ✓                       │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ 🔌 ST-Link (STM32CubeProgrammer) ✓ 已安装 (内建) │    │
│  │    通过 ST-Link 调试器烧录 STM32                  │    │
│  │    外部工具: STM32_Programmer_CLI ✓              │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ 🔌 ESP32 (esptool)               ○ 未安装       │    │
│  │    ESP32/ESP8266 烧录支持                        │    │
│  │    需要: Python 3 + esptool                      │    │
│  │    [一键安装]                                    │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ 🔌 RP2040 (picotool)             ○ 未安装       │    │
│  │    Raspberry Pi Pico 烧录支持                    │    │
│  │    需要: picotool                                │    │
│  │    [一键安装]                                    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 5. 芯片/平台支持矩阵

### 5.1 完整的支持关系

| 芯片/平台 | 烧录协议 | 传输接口 | 依赖工具 | 模块状态 | 支持格式 |
|-----------|---------|---------|---------|---------|---------|
| **STM32 全系列** | 串口 ISP | UART (BOOT0=1) | 无 (Rust 实现) | 内置 | hex, bin |
| **STM32 全系列** | ST-Link | SWD | STM32CubeProgrammer CLI 或 OpenOCD | 内置 | hex, bin, elf |
| **STM32 全系列** | DFU | USB | dfu-util | 内置 | dfu, bin |
| **Arduino AVR** (Uno/Nano/Mega) | STK500v1/v2 | UART | avrdude | 内置 | hex |
| **Arduino 32U4** (Leonardo/Micro) | avr109 | UART | avrdude | 内置 | hex |
| **STM32duino** (BluePill/Maple) | Maple DFU | USB | dfu-util | 可选 | bin |
| **ESP32 / ESP32-S2/S3/C3** | esptool | UART | esptool.py + Python | 可选 | bin, elf |
| **ESP8266** | esptool | UART | esptool.py + Python | 可选 | bin |
| **RP2040** (Pico/W) | UF2 / picotool | USB | picotool | 可选 | uf2, bin, elf |
| **nRF52** | nrfutil | UART/DFU | nrfutil | 可选 | hex |
| **CH32V** (WCH) | WCH ISP | UART | wchisp | 可选(未来) | bin |
| **GD32** | 串口 ISP | UART | 无 (复用 STM32 ISP) | 可选(未来) | hex, bin |

### 5.2 芯片自动识别

连接后，通过以下方式自动识别芯片：
1. **串口 ISP**：发送 `0x7F` → 读取 Bootloader 版本和 PID → 查芯片数据库匹配
2. **ST-Link**：`STM32_Programmer_CLI -c port=SWD` → 解析输出获取 Device ID
3. **Arduino bootloader**：发送 STK500 `get_sync` → 读取 signature bytes
4. **DFU**：`dfu-util -l` → 解析 VID/PID 和设备描述符

识别到的芯片信息自动填入烧录面板，减少用户手动选择。

---

## 6. 文件格式支持

### 6.1 格式解析器设计

```rust
/// 固件文件解析的统一接口
pub trait FirmwareParser: Send + Sync {
    fn format_name(&self) -> &'static str;
    fn extensions(&self) -> &[&str];
    fn parse(&self, data: &[u8]) -> Result<FirmwareData>;
}
```

### 6.2 支持格式

| 格式 | 扩展名 | 解析方式 | 状态 | 特性 |
|------|--------|---------|------|------|
| **Intel HEX** | `.hex`, `.ihx` | Rust 自研 parser | 内置 | 自动识别地址范围、多段合并、校验 |
| **Binary** | `.bin` | 直接读取 | 内置 | 需用户指定起始地址（默认按芯片 flash_start） |
| **Motorola SREC** | `.srec`, `.s19`, `.s28`, `.s37` | Rust 自研 parser | 内置 | 类似 HEX 的文本格式，汽车电子常用 |
| **ELF** | `.elf`, `.axf`, `.out` | `goblin` crate | 可选 | 提取 `.text`/`.data` 段，自动计算地址 |
| **DFU** | `.dfu` | Rust 自研 parser | 可选 | 解析 DFU suffix + 多映像 |
| **UF2** | `.uf2` | Rust 自研 parser | 可选 | RP2040 专用格式，512 字节块 |

### 6.3 固件解析结果数据结构

```rust
pub struct FirmwareData {
    /// 文件名
    pub filename: String,
    /// 原始格式
    pub source_format: FirmwareFormat,
    /// 解析后的内存段列表
    pub segments: Vec<MemorySegment>,
    /// 总大小（字节）
    pub total_size: usize,
    /// 覆盖的地址范围
    pub address_range: Range<u32>,
    /// 校验和
    pub checksum: Vec<u8>, // 按段的 SHA-256
}

pub struct MemorySegment {
    pub address: u32,
    pub data: Vec<u8>,
}
```

### 6.4 固件信息预览（前端）

拖入或选择文件后，立即显示解析结果：

```
┌──────────────────────────────────┐
│  📄 firmware.hex                 │
│  ─────────────────────────────── │
│  格式:     Intel HEX             │
│  大小:     48.2 KB               │
│  地址范围: 0x08000000 - 0x0800C0FF│
│  段数:     3                     │
│  校验:     SHA-256 ✓            │
│  ─────────────────────────────── │
│  段 #1:  0x08000000 (32 KB)      │
│  段 #2:  0x08008000 (16 KB)      │
│  段 #3:  0x0800C000 (208 B)      │
│                                  │
│  估计烧录时间: ~5 秒             │
└──────────────────────────────────┘
```

---

## 7. 前端设计

### 7.1 目录结构

```
src/
├── main.tsx                    # 入口
├── App.tsx                     # 根组件
├── assets/
│   └── locales/                # 国际化资源
│       ├── zh-CN/
│       │   ├── common.json
│       │   ├── monitor.json
│       │   ├── flash.json
│       │   └── settings.json
│       ├── en-US/
│       │   ├── common.json
│       │   ├── monitor.json
│       │   ├── flash.json
│       │   └── settings.json
│       └── ja-JP/ ...          # 日语（可后续添加）
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx        # 主窗口外壳
│   │   ├── Sidebar.tsx         # 侧边栏（端口列表、快捷操作）
│   │   ├── TitleBar.tsx        # 自定义标题栏（Windows）
│   │   └── StatusBar.tsx       # 底部状态栏
│   ├── monitor/
│   │   ├── MonitorView.tsx     # 监视器主视图
│   │   ├── MonitorToolbar.tsx  # 工具栏（清屏、暂停、导出、时间戳）
│   │   ├── OutputLine.tsx      # 单行输出（虚拟滚动优化）
│   │   └── SendInput.tsx       # 发送输入框（带历史记录）
│   ├── flash/
│   │   ├── FlashPanel.tsx      # 烧录面板
│   │   ├── ChipSelector.tsx    # 芯片选择器（树形：系列→型号）
│   │   ├── FileDropZone.tsx    # 固件拖放区
│   │   ├── FirmwareInfo.tsx    # 固件信息展示
│   │   ├── FlashProgress.tsx   # 烧录进度（进度条+日志）
│   │   └── FlashOptions.tsx    # 烧录选项（擦除方式、校验等）
│   ├── settings/
│   │   ├── SettingsPage.tsx
│   │   ├── GeneralSettings.tsx # 通用设置
│   │   ├── SerialDefaults.tsx  # 串口默认参数
│   │   ├── ModuleManager.tsx   # 模块管理
│   │   ├── ThemeSettings.tsx   # 主题设置
│   │   └── LanguageSettings.tsx# 语言设置
│   └── shared/
│       ├── PortSelector.tsx    # 端口下拉选择器
│       ├── BaudRateInput.tsx   # 波特率输入（预设+自定义）
│       ├── SearchableSelect.tsx# 可搜索下拉框
│       └── ConfirmDialog.tsx   # 确认对话框
├── hooks/
│   ├── useSerial.ts           # 串口数据 hook
│   ├── useFlash.ts            # 烧录状态 hook
│   ├── usePortScanner.ts      # 端口扫描 hook
│   └── useTheme.ts            # 主题 hook
├── stores/
│   ├── appStore.ts            # 全局应用状态（状态机）
│   ├── serialStore.ts         # 串口连接状态
│   ├── flashStore.ts          # 烧录状态
│   └── settingsStore.ts       # 配置持久化存储
├── i18n.ts                    # i18next 配置
├── lib/
│   ├── stateMachine.ts        # 状态机实现
│   └── tauriBindings.ts       # Tauri invoke 封装
└── types/
    ├── serial.ts
    ├── flash.ts
    └── settings.ts
```

### 7.2 主窗口布局

```
┌──────────────────────────────────────────────────────────────┐
│  SerialHelper    [端口: COM3 ▼] [115200 ▼] [8N1 ▼] [连接/断开]│  ← TitleBar
├───────────┬──────────────────────────────────────────────────┤
│  侧边栏   │              主内容区                             │
│           │                                                   │
│ 📟 监视器  │  ┌───────────────────────────────────────────┐  │
│ 🔥 烧录    │  │  监视器输出                                   │  │
│ ⚙ 设置     │  │                                              │  │
│           │  │  [15:30:01.234] System boot OK                │  │
│ ───────── │  │  [15:30:01.456] FW version: 1.3.2             │  │
│ 设备      │  │  [15:30:01.678] Initializing sensors...       │  │
│ ● COM3    │  │  [15:30:02.012] Sensor A: 23.5°C              │  │
│   STLink  │  │  [15:30:02.345] Sensor B: 47.2°C              │  │
│ ○ COM5    │  │  [15:30:02.678] All systems nominal           │  │
│   Arduino │  │  ...                                           │  │
│ ○ COM7    │  │                                              │  │
│           │  └───────────────────────────────────────────┘  │
│ ───────── │  ─────────────────────────────────────────────── │
│ 快捷操作  │  发送: [___________________] [发送] [CRLF ▼] [↑↓]│
│ [自动重连]│                                              │
│ [保存日志]│                                              │
│ [清屏]    │                                              │
│           │                                              │
├───────────┴──────────────────────────────────────────────────┤
│ 状态: ● 已连接 COM3 | 115200-8N1 | RX: 12.4 KB | TX: 256 B   │  ← StatusBar
└──────────────────────────────────────────────────────────────┘
```

点击"烧录"后，监视区自动变成烧录面板：

```
┌──────────────────────────────────────────────────────────────┐
│  SerialHelper    [端口: COM3 ▼] [115200 ▼] [8N1 ▼] [正在烧录]│
├───────────┬──────────────────────────────────────────────────┤
│  侧边栏   │              主内容区                             │
│           │                                                   │
│ 📟 监视器  │  ┌───────────────────────────────────────────┐  │
│ 🔥 烧录    │  │  🔥 正在烧录 STM32F103C8 (串口 ISP)         │  │
│ ⚙ 设置     │  │                                              │  │
│           │  │  ████████████████░░░░░░░░░░  68%              │  │
│           │  │                                              │  │
│           │  │  [INFO] 进入 bootloader...           ✓       │  │
│           │  │  [INFO] 芯片: STM32F103C8, 64KB Flash ✓       │  │
│           │  │  [INFO] 擦除 Flash...                ✓       │  │
│           │  │  [INFO] 写入中: 0x0800A000 (43/64 KB) →      │  │
│           │  │  [INFO] 校验中...                     →      │  │
│           │  │                                              │  │
│           │  └───────────────────────────────────────────┘  │
│           │  ────────────────────────────────────────────   │
│           │  [取消烧录]                                      │
│           │                                              │
├───────────┴──────────────────────────────────────────────────┤
│ 状态: 🔥 烧录中 | STM32F103C8 | firmware.hex | 剩余约 3 秒   │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 主题系统设计

**三种主题预设 + 完全自定义：**

```typescript
type ThemePreset = 'system' | 'light' | 'dark';

interface ThemeConfig {
  preset: ThemePreset;
  colors: {
    // 语义色（两种模式下各一套）
    background: { light: string; dark: string };
    surface: { light: string; dark: string };
    text: { primary: { light: string; dark: string }; secondary: { light: string; dark: string } };
    accent: { light: string; dark: string };       // 主色调（可自定义）
    success: string;   // 烧录成功绿
    warning: string;   // 警告橙
    error: string;     // 错误红
    // 监视器特定
    monitor: {
      rx: string;      // 接收数据颜色
      tx: string;      // 发送数据颜色
      timestamp: string;
      system: string;  // 系统消息颜色
    };
  };
  fonts: {
    mono: string;      // 等宽字体（监视器用）
    sans: string;      // UI 字体
  };
}
```

**Tailwind 实现**：使用 CSS 变量 + `dark:` 修饰符，主题切换只需切换 `class="dark"` 在 `<html>` 上。

```
亮色主题 (Solarized Light 改编):
- 背景: #FDF6E3 (暖白)
- 监视器背景: #F8F3E6
- RX 文字: #2AA198 (青)
- TX 文字: #268BD2 (蓝)

暗色主题 (Dracula 改编):
- 背景: #282A36
- 监视器背景: #1E1F29
- RX 文字: #50FA7B (绿)
- TX 文字: #8BE9FD (青)
```

### 7.4 国际化设计

**命名空间划分**：

```
locales/
├── zh-CN/
│   ├── common.json      # 通用：连接、断开、保存、取消...
│   ├── monitor.json     # 监视器：清屏、暂停、导出...
│   ├── flash.json       # 烧录：擦除、写入、校验、芯片名...
│   └── settings.json    # 设置页各标签
├── en-US/
│   └── (同上)
```

**示例翻译片段**：

```json
// zh-CN/flash.json
{
  "title": "烧录",
  "select_chip": "选择芯片",
  "chip_family": "芯片系列",
  "chip_variant": "具体型号",
  "start_flash": "开始烧录",
  "cancel_flash": "取消烧录",
  "progress": {
    "entering_bootloader": "正在进入 Bootloader...",
    "erasing": "正在擦除 Flash...",
    "writing": "正在写入: {{addr}} ({{current}}/{{total}} KB)",
    "verifying": "正在校验...",
    "complete": "烧录完成！耗时 {{duration}}",
    "resuming_monitor": "正在恢复监视器..."
  },
  "errors": {
    "no_bootloader_response": "芯片无响应，请检查 BOOT0 是否置高",
    "verify_failed": "校验失败！期望 {{expected}}，实际 {{actual}}，地址 {{addr}}",
    "tool_not_found": "未找到 {{tool}}，请在模块管理中安装"
  }
}
```

### 7.5 前端交互与布局备忘

为避免后续页面演进时出现风格漂移，补充以下前端约束：

- 设置页中的分组标题应精简，但不能引起语义歧义。
  例如在设置页中使用“监视器”“烧录”，而不是“监视器设置”“烧录默认值”。
- 模块管理应作为独立页面存在，而不是塞入设置页。
  设置页负责“配置”，模块页负责“能力、状态、环境与安装引导”。
- 每个设置项都应有独立的语义图标，不要只给分组标题加图标。
- 子配置项应作为父配置项的缩进行展示，仅在父项启用时出现。
  例如“切换到监视器页面”属于“烧录后恢复监视器”的子配置。
- 工具型页面优先采用“工具栏 + 分割线分栏”的布局组织方式，避免无必要地堆叠大量卡片。
  监视器页和烧录页应保持这一类工具页面的一致交互节奏。
- 高频状态日志应尽量原地更新，而不是不断追加新行，避免日志区被进度刷屏。
- 固件路径、烧录选项和读取范围这类高频复用状态应持久化保存，页面切换和重启软件后应尽量恢复现场。

---

## 8. 后端详细设计

### 8.1 Rust crate 结构

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── capabilities/
│   └── default.json          # Tauri 权限配置
├── src/
│   ├── main.rs               # Tauri 入口 + 命令注册
│   ├── lib.rs                # 库根
│   ├── error.rs              # 统一错误类型
│   ├── state.rs              # AppState (Mutex 管理)
│   ├── serial/
│   │   ├── mod.rs
│   │   ├── manager.rs        # SerialManager: 打开/关闭/读写
│   │   ├── scanner.rs        # PortScanner: 实时扫描端口变化
│   │   └── config.rs         # SerialConfig: 波特率/数据位/校验...
│   ├── flash/
│   │   ├── mod.rs
│   │   ├── orchestrator.rs   # FlashOrchestrator: 烧录流程编排
│   │   ├── registry.rs       # ModuleRegistry: 模块注册/发现
│   │   ├── module_trait.rs   # FlashModule trait 定义
│   │   ├── config.rs         # FlashConfig
│   │   ├── progress.rs       # FlashProgress 事件类型
│   │   └── result.rs         # FlashResult
│   ├── modules/
│   │   ├── mod.rs
│   │   ├── stm32_isp/
│   │   │   ├── mod.rs
│   │   │   ├── protocol.rs   # 协议实现
│   │   │   ├── commands.rs   # ISP 命令枚举
│   │   │   └── chips.rs      # STM32 芯片数据库
│   │   ├── arduino_avr/
│   │   │   ├── mod.rs
│   │   │   ├── avrdude.rs    # avrdude 进程管理
│   │   │   └── chips.rs
│   │   ├── stlink/
│   │   │   ├── mod.rs
│   │   │   ├── cube_prog.rs
│   │   │   └── openocd.rs
│   │   └── dfu/
│   │       ├── mod.rs
│   │       └── dfu_util.rs
│   ├── firmware/
│   │   ├── mod.rs
│   │   ├── parser_trait.rs   # FirmwareParser trait
│   │   ├── hex.rs            # Intel HEX 解析
│   │   ├── srec.rs           # Motorola SREC 解析
│   │   ├── bin.rs            # 纯二进制
│   │   ├── elf.rs            # ELF (via goblin)
│   │   └── dfu_file.rs       # DFU 文件格式
│   ├── tools/
│   │   ├── mod.rs
│   │   ├── registry.rs       # ToolRegistry: 外部工具注册表
│   │   ├── checker.rs        # 检测外部工具是否安装
│   │   └── installer.rs      # 引导安装外部工具
│   └── commands/
│       ├── mod.rs
│       ├── serial_cmd.rs     # Tauri 命令: 串口操作
│       ├── flash_cmd.rs      # Tauri 命令: 烧录操作
│       ├── module_cmd.rs     # Tauri 命令: 模块管理
│       └── tools_cmd.rs      # Tauri 命令: 工具检测
```

### 8.2 IPC 通信协议设计

```typescript
// === 前端 → 后端 (Tauri invoke) ===

// 串口操作
invoke('serial_list_ports') → PortInfo[]
invoke('serial_open', { port: string, config: SerialConfig }) → void
invoke('serial_close') → void
invoke('serial_write', { data: number[] }) → void

// 烧录操作
invoke('flash_start', { module: string, chip: string, filePath: string, options: FlashOptions }) → void
invoke('flash_cancel') → void

// 模块管理
invoke('module_list') → ModuleInfo[]
invoke('module_install', { moduleId: string }) → void
invoke('module_check_env', { moduleId: string }) → EnvStatus

// 文件解析
invoke('firmware_parse', { filePath: string }) → FirmwareInfo

// 设置
invoke('settings_load') → AppSettings
invoke('settings_save', { settings: AppSettings }) → void


// === 后端 → 前端 (Tauri events) ===

// 串口数据流
listen('serial-data', (payload: { data: number[]; timestamp: number }) => ...)
listen('serial-ports-changed', (payload: { ports: PortInfo[] }) => ...)
listen('serial-error', (payload: { message: string }) => ...)

// 烧录进度
listen('flash-progress', (payload: FlashProgress) => ...)
listen('flash-log', (payload: { level: string; message: string }) => ...)
listen('flash-complete', (payload: FlashResult) => ...)
listen('flash-error', (payload: { message: string }) => ...)
```

### 8.3 数据缓冲策略

监视器高频数据传输优化：

```
串口硬件 → 4KB 硬件缓冲
         ↓
后台读取线程 (tokio task, 1ms 间隔批量读取)
         ↓
Rust 侧缓冲: 每 5ms 或累积 256 字节时批量发送
         ↓
Tauri Event → 前端
         ↓
React 侧: requestAnimationFrame 批量追加到虚拟滚动列表
```

虚拟滚动使用 `@tanstack/react-virtual`，确保万行日志不卡顿。

---

## 9. 配置持久化

```rust
// 配置文件位置: %APPDATA%/SerialHelper/config.json
//                ~/Library/Application Support/SerialHelper/config.json (macOS)
//                ~/.config/SerialHelper/config.json (Linux)

#[derive(Serialize, Deserialize)]
pub struct AppConfig {
    pub serial_defaults: SerialDefaults,
    pub flash_defaults: FlashDefaults,
    pub ui: UiConfig,
    pub modules: ModulesConfig,
}

#[derive(Serialize, Deserialize)]
pub struct SerialDefaults {
    pub baud_rate: u32,      // 默认 115200
    pub data_bits: DataBits, // 8
    pub stop_bits: StopBits, // 1
    pub parity: Parity,      // None
    pub flow_control: FlowControl, // None
}

#[derive(Serialize, Deserialize)]
pub struct FlashDefaults {
    pub auto_verify: bool,           // 默认 true
    pub auto_resume_monitor: bool,   // 默认 true
    pub erase_mode: EraseMode,       // Full / Page / None
    pub verify_mode: VerifyMode,     // Fast / Full
    pub post_flash_reset: bool,      // 默认 true
}

#[derive(Serialize, Deserialize)]
pub struct UiConfig {
    pub theme: ThemePreset,          // system / light / dark
    pub language: String,            // zh-CN / en-US
    pub font_size: u8,               // 监视器字号 10-24
    pub timestamp_enabled: bool,     // 默认 true
    pub timestamp_format: String,    // HH:mm:ss.SSS
    pub auto_scroll: bool,           // 默认 true
    pub line_ending: LineEnding,     // CRLF / LF / CR
    pub encoding: String,            // UTF-8 / GB2312 / Latin1
    pub monitor_max_lines: u32,      // 最大缓存行数，默认 50000
}
```

---

## 10. 错误处理策略

统一错误类型：

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("串口被占用: {0}")]
    PortInUse(String),

    #[error("串口未找到: {0}")]
    PortNotFound(String),

    #[error("串口通信错误: {0}")]
    SerialError(#[from] serialport::Error),

    #[error("固件解析失败: {0}")]
    FirmwareParseError(String),

    #[error("不支持的芯片: {0}")]
    UnsupportedChip(String),

    #[error("外部工具未找到: {tool}，请运行: {install_cmd}")]
    ToolNotFound { tool: String, install_cmd: String },

    #[error("烧录失败: {0}")]
    FlashError(String),

    #[error("烧录已取消")]
    FlashCancelled,

    #[error("校验失败: 地址 {addr:#010X} 期望 {expected:#04X} 实际 {actual:#04X}")]
    VerifyFailed { addr: u32, expected: u8, actual: u8 },
}
```

所有错误通过 Tauri IPC 序列化传到前端，前端根据错误类型展示对应级别的通知（toast / inline / dialog）。

---

## 11. 开发路线图

### Phase 1 — 基础框架 (MVP 核心)
- [ ] Tauri + React 项目脚手架搭建
- [ ] Tailwind CSS + 主题系统（暗色/亮色切换）
- [ ] i18next 国际化框架 + 中/英文语言包骨架
- [ ] 侧边栏布局 + 路由
- [ ] Rust 串口扫描 + 打开/关闭
- [ ] 监视器页面：日志输出 + 虚拟滚动
- [ ] 发送输入框 + 历史记录
- [ ] 全局状态机实现

### Phase 2 — 核心烧录能力
- [ ] Rust Intel HEX 解析器
- [ ] Rust Binary 解析器
- [ ] STM32 串口 ISP 协议（Rust 实现）
- [ ] STM32 芯片数据库（F1/F4 优先）
- [ ] Arduino AVR 模块（avrdude 封装）
- [ ] 烧录面板 UI（芯片选择 + 文件拖放 + 进度条）
- [ ] 烧录 → 监视器自动切换逻辑

### Phase 3 — 扩展能力
- [ ] Motorola SREC 解析器
- [ ] ST-Link 模块（STM32CubeProgrammer CLI 封装）
- [ ] DFU 模块（dfu-util 封装）
- [ ] 模块管理器 UI（安装/卸载可选模块）
- [ ] 外部工具自动检测 + 安装引导

### Phase 4 — 更多平台
- [ ] ESP32 模块（esptool 封装）
- [ ] RP2040 模块（picotool 封装）
- [ ] STM32duino 模块
- [ ] ELF 解析器
- [ ] DFU 文件解析器

### Phase 5 — 打磨
- [ ] 日志导出（.log / .csv）
- [ ] DTR/RTS 手动控制
- [ ] 串口流控配置
- [ ] 快捷键系统
- [ ] 自动更新（Tauri updater）
- [ ] 跨平台打包配置
- [ ] 完整的中英文翻译
- [ ] 日语翻译（社区贡献）

---

## 12. 关键设计决策总结

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 状态机 | 前端 Zustand + 后端实际串口状态双重管理 | 前端响应用户交互，后端保证硬件安全 |
| 模块系统 | Rust trait + manifest.toml + 可选外部工具 | 编译安全 + 灵活扩展 + 用户可选择安装 |
| 数据流 | Tauri Event 推送（非轮询） | 低延迟、低 CPU 占用 |
| 主题 | Tailwind dark mode + CSS 变量 | 实现简单、无需 JS 运行时切换 |
| 虚拟滚动 | @tanstack/react-virtual | 万行日志无性能压力 |
| 芯片数据库 | 每个模块自带的 chips.rs / chips.json | 分散维护、模块自治 |
| 外部工具 | 检测 + 引导安装（不捆绑） | 减小包体积、避免 license 问题 |
| STM32 ISP | Rust 自实现（非调用 stm32flash） | 更好的错误处理、进度反馈、跨平台一致 |

---

*本文档为 SerialHelper 最终设计方案定稿，后续开发将基于此文档进行。*
