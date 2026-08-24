/**
 * Official / Wikimedia Commons shots matched onto catalog names.
 * Uploaded ProductImage rows always win. This pack is the fallback so
 * current sellable SKUs can show a photo before staff replace it.
 *
 * Only packs with two clean, watermark-free photos of the exact model
 * (or the same chassis for RAM/SSD variants) are listed.
 */

export type CatalogPhotoPack = {
  id: string
  label: string
  /** Lowercase phrases; longest matching phrase wins. */
  match: string[]
  source: {
    hero: string
    detail: string
    attribution: string
  }
}

export const CATALOG_PHOTO_PACKS: CatalogPhotoPack[] = [
  {
    id: 'logitech-m185',
    label: 'Logitech M185 Wireless Mouse',
    match: ['logitech m185 wireless mouse', 'logitech m185', 'm185'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/2/2e/Logitech_M185_mouse_HS01.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/5/51/Logitech_M185_mouse_HS02.jpg',
      attribution: 'Wikimedia Commons — Logitech M185 (CC-licensed product photos)',
    },
  },
  {
    id: 'logitech-m100',
    label: 'Logitech M90 / M100 wired mouse',
    match: ['logitech m90 wired mouse', 'logitech m90', 'logitech m100', 'ugreen usb wired mouse'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/6/66/Logitech_M100_%28Lost%26Found_WikiCon_2017%29.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/6/66/Logitech_M100_%28Lost%26Found_WikiCon_2017%29.jpg',
      attribution: 'Wikimedia Commons — Logitech M100 (visually the M90/M100/B100 family)',
    },
  },
  {
    id: 'sandisk-cruzer-blade',
    label: 'SanDisk Cruzer Blade',
    match: ['cruzer blade', 'sandisk cruzer'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/8/87/SanDisk_Cruzer_Blade.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/6/61/SanDisk_SDCZ50-008G-B35_20140610.jpg',
      attribution: 'Wikimedia Commons — SanDisk Cruzer Blade / SDCZ50',
    },
  },
  {
    id: 'tplink-wr740n',
    label: 'TP-Link 300Mbps Wireless N Router',
    match: ['300mbps wireless n router', 'tl-wr740n', 'wireless n router'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/5/50/TP-Link_TL-WR740N_router_HS1.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/5/5f/TP-Link_TL-WR740N_router_HS2.jpg',
      attribution: 'Wikimedia Commons — TP-Link TL-WR740N (300 Mbps Wireless N)',
    },
  },
  {
    id: 'tplink-usb-wifi',
    label: 'TP-Link 300Mbps Mini Wireless N USB Adapter',
    match: ['300mbps mini wireless', 'mini wireless n usb', 'tl-wn821n'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/e/ec/Tp-link_usb_wi-fi_dongle_tl-wn821n.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/b/b2/TP-Link_USB_Wi-Fi_adapter_01.jpg',
      attribution: 'Wikimedia Commons — TP-Link USB Wireless N adapter',
    },
  },
  {
    id: 'displayport-vga',
    label: 'DisplayPort-to-VGA Adapter',
    match: ['displayport-to-vga', 'displayport to vga', 'dp-to-vga', 'displayport-to-vga converter', 'vention displayport'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/Display_Port_to_VGA_cable_20220305_080613.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/e/ee/Display_Port_to_VGA_cable_20220305_080635.jpg',
      attribution: 'Wikimedia Commons — DisplayPort to VGA adapter',
    },
  },
  {
    id: 'hdmi-cable',
    label: 'HDMI cable',
    match: ['hdmi-to-hdmi', 'hdmi cable 5m', 'flat hdmi', 'ugreen hdmi'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/9/90/HDMI_Cable.JPG',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/c/c2/HDMI-Connector.jpg',
      attribution: 'Wikimedia Commons — HDMI cable / connector',
    },
  },
  {
    id: 'laptop-stand',
    label: 'Laptop Stand',
    match: ['laptop stand'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/4/43/Laptop_stand.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Passive_Laptop_cooler.jpg',
      attribution: 'Wikimedia Commons — laptop stand',
    },
  },
  {
    id: 'fujitsu-lifebook',
    label: 'Fujitsu LifeBook',
    match: ['fujitsu lifebook', 'lifebook'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/a/af/20200313_173009_Fujitsu_Lifebook_U757.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/1/16/20200313_173056_Fujitsu_Lifebook_U757_back.jpg',
      attribution: 'Wikimedia Commons — Fujitsu LifeBook U757 (same U-series chassis family)',
    },
  },
  {
    id: 'thinkpad-yoga',
    label: 'Lenovo ThinkPad Yoga',
    match: ['thinkpad x1 yoga', 'x1 yoga', 'thinkpad yoga'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/2/22/ThinkPad_L380_Yoga_%2840082639183%29.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/6/67/ThinkPad_L380_Yoga_%2846272545054%29.jpg',
      attribution: 'Wikimedia Commons — ThinkPad Yoga convertible (L380 Yoga; same Yoga chassis language as X1 Yoga)',
    },
  },
  {
    id: 'hp-elitebook-840',
    label: 'HP EliteBook 840',
    match: ['elitebook 840', 'hp 840 g'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/9/9a/HP_EliteBook_840_G8.png',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/c/c4/HP_EliteBook_840_G3_IMG_20231216_135720.jpg',
      attribution: 'Wikimedia Commons — HP EliteBook 840 G8 / G3',
    },
  },
  {
    id: 'm2-2280-nvme',
    label: 'M.2 2280 NVMe SSD',
    match: ['m.2 2280', 'm.2 nvme ssd 512', 'pcie gen 3 x4 nvme', 'lexar m.2'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/1TB_2280_NVME_SSD.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/7/75/Samsung_980_PRO_PCIe_4.0_NVMe_SSD_1TB-top_PNr%C2%B00915.jpg',
      attribution: 'Wikimedia Commons — M.2 2280 NVMe SSD (form-factor match)',
    },
  },
  {
    id: 'usb-c-hub',
    label: 'USB-C hub',
    match: ['5-in-1 usb 3.0 hub', '5-in-1 usb-c', 'usb-c hub', 'usb-c multifunction', 'ugreen 6-in-1', 'ugreen 5-in-1', 'vention 5-in-1'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/7/76/USB-C_Hubb_5_portar.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/5/5b/USB_C_Hub.png',
      attribution: 'Wikimedia Commons — 5-port USB-C hub',
    },
  },
  {
    id: 'usb-ethernet',
    label: 'USB Ethernet adapter',
    match: ['usb 3.0 gigabit ethernet', 'usb 3.0 / usb type-c 3.1 ethernet', 'ethernet adapter', 'ugreen usb 3.0 gigabit'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/c/ce/TP-Link_UE300_ethernet_USB_adapter_HS1.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/d/de/TP-Link_UE300_ethernet_USB_adapter_HS2.jpg',
      attribution: 'Wikimedia Commons — USB 3.0 Gigabit Ethernet adapter',
    },
  },
  {
    id: 'epson-ecotank-ink',
    label: 'Epson EcoTank ink bottles',
    match: ['epson 103'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/b/bc/Flacons_d%27encres_4_couleurs_113_pour_imprimantes_EPSON_ECOTANK_ET.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/b/bc/Flacons_d%27encres_4_couleurs_113_pour_imprimantes_EPSON_ECOTANK_ET.jpg',
      attribution: 'Wikimedia Commons — Epson EcoTank ink bottles (103/113 family)',
    },
  },
  {
    id: 'laptop-lock',
    label: 'Notebook computer lock',
    match: ['notebook computer lock', 'laptop lock'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Kensington_Laptop_Lock_1_2019-05-06.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Kensington_Laptop_Lock_2_2019-05-06.jpg',
      attribution: 'Wikimedia Commons — notebook security lock',
    },
  },
  {
    id: 'nec-versapro',
    label: 'NEC VersaPro / NEC laptop',
    match: ['nec versapro 2-in-1', 'nec versapro', 'nec laptop', 'versapro'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/c/c6/NEC_VersaPro_VA70H.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/The_keyboard_of_NEC_VersaPro_VA70H.jpg',
      attribution: 'Wikimedia Commons — NEC VersaPro VA70H (same VersaPro business-laptop family)',
    },
  },
  {
    id: 'dell-latitude-2in1',
    label: 'Dell Latitude 2-in-1',
    match: ['latitude 3190', 'latitude 3189', 'dell latitude 2-in-1', '2-in-1'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/2/2a/Dell_Latitude_XT_with_optional_Media_Base.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/2/2a/Dell_Latitude_XT_with_optional_Media_Base.jpg',
      attribution: 'Wikimedia Commons — Dell Latitude 2-in-1 convertible family (XT; closest CC-licensed Dell 2-in-1; cropped to the laptop)',
    },
  },
  {
    id: 'wireless-mouse',
    label: 'Wireless mouse',
    match: ['logitech m190 wireless mouse', 'logitech m190', 'ugreen 2.4ghz', 'ugreen mu102', 'wireless mouse'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/f/f1/A_black_wireless_computer_mouse.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/7/77/A_wireless_computer_mouse.jpg',
      attribution: 'Wikimedia Commons — black wireless mouse (form-factor fallback)',
    },
  },
  {
    id: 'cat6-patch',
    label: 'Cat 6 patch cord',
    match: ['utp cat 6', 'cat 6 patch', 'patch cord'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/7/78/Patch_cable_with_RJ45_connector.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/0/05/EthernetCableBlue2.jpg',
      attribution: 'Wikimedia Commons — RJ45 / Ethernet patch cable',
    },
  },
  {
    id: 'usb-printer-cable',
    label: 'USB printer cable',
    match: ['usb printer cable', 'usb a & b', 'usb-a to usb-b'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/USB_A_%26_B_cable.agr.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/USB_A_%26_B_cable.agr.jpg',
      attribution: 'Wikimedia Commons — USB-A to USB-B printer cable',
    },
  },
  {
    id: 'eight-port-switch',
    label: '8-port Ethernet switch',
    match: ['8-port 10/100', '8-port', 'network switch'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/8-Port_Gigabit_Switch_HP_1810G-8.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/8-Port_Gigabit_Switch_HP_1810G-8.jpg',
      attribution: 'Wikimedia Commons — 8-port gigabit desktop switch (form-factor match)',
    },
  },
  {
    id: 'seagate-portable-hdd',
    label: 'Portable / desktop HDD',
    match: ['seagate 8tb', 'seagate', 'netac usb 3.0 external', 'external hard drive'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/c/cb/Seagate_SRD0NF1_portable_hard_drive_HS1.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/a/a4/Seagate_SRD0NF1_portable_hard_drive_HS2.jpg',
      attribution: 'Wikimedia Commons — Seagate portable hard drive',
    },
  },
  {
    id: 'travel-adapter',
    label: 'Universal travel adapter',
    match: ['universal travel adapter', 'travel adapter'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/c/c5/Samsung_Travel_Adapter_3.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Samsung_Travel_Adapter_2.jpg',
      attribution: 'Wikimedia Commons — USB travel adapter (form-factor match)',
    },
  },
  {
    id: 'hdmi-vga',
    label: 'VGA-to-HDMI adapter',
    match: ['vga-to-hdmi', 'vga to hdmi', 'ugreen vga'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/4/49/HDMI%E8%BD%89VGA%E8%BD%89%E6%8E%A5%E9%A0%AD.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/4/49/HDMI%E8%BD%89VGA%E8%BD%89%E6%8E%A5%E9%A0%AD.jpg',
      attribution: 'Wikimedia Commons — HDMI/VGA adapter',
    },
  },
  {
    id: 'crimp-tool',
    label: 'Modular plug crimping tool',
    match: ['crimping tool', 'modular plug'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/c/ca/Crimping_tool_TP2.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/3/3c/Crimping_tool_TP.jpg',
      attribution: 'Wikimedia Commons — network modular crimping tool',
    },
  },
  {
    id: 'inkjet-cartridge',
    label: 'Inkjet cartridge',
    match: ['hp 963', 'ink cartridge'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Remanufactured_ink_cartridge.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Remanufactured_ink_cartridge.jpg',
      attribution: 'Wikimedia Commons — inkjet cartridge (form-factor match for HP 963)',
    },
  },
  {
    id: 'm2-enclosure',
    label: 'M.2 NVMe SSD enclosure',
    match: ['ssd enclosure', 'm.2 nvme ssd enclosure', 'ugreen m.2 nvme ssd enclosure'],
    source: {
      hero: 'https://live.staticflickr.com/65535/52355786136_869cb01474_b.jpg',
      detail: 'https://live.staticflickr.com/65535/52355786136_869cb01474_b.jpg',
      attribution: 'Flickr / Openverse — ACASIS M.2 PCIe enclosure (CC BY 2.0, form-factor match)',
    },
  },
  {
    id: 'overear-headphones',
    label: 'Over-ear headphones',
    match: ['studio pro headphones', 'headphones'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/0/0a/Bose_QuietComfort_25_Acoustic_Noise_Cancelling_Headphones_with_Carry_Case.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/0/0a/Bose_QuietComfort_25_Acoustic_Noise_Cancelling_Headphones_with_Carry_Case.jpg',
      attribution: 'Wikimedia Commons — over-ear headphones (form-factor match)',
    },
  },
  {
    id: 'lavalier-mic',
    label: 'Wireless lavalier microphone',
    match: ['hollyland lark', 'lark m2', 'wireless lavalier', 'lavalier microphone'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/b/b7/Rode_Wireless_Go_II_Set.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/7/7e/Rode_Wireless_Go_II_microphone.jpg',
      attribution: 'Wikimedia Commons — RØDE Wireless GO II clip-on set (form-factor match for Hollyland Lark M2)',
    },
  },
  {
    id: 'power-bank',
    label: 'USB power bank',
    match: ['two-way fast-charging power bank', 'power bank', '2000mah'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/e/e9/SAMSUNG_BATTERY_PACK_%28POWER_BANK%29_EB-P1100C.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/1/1e/SAMSUNG_BATTERY_PACK_%28POWER_BANK%29_EB-P1100C_%282%29.jpg',
      attribution: 'Wikimedia Commons — USB power bank (form-factor match)',
    },
  },
  {
    id: 'usb-c-cable',
    label: 'USB-C charging cable',
    match: ['uno usb-c', 'usb-c to usb-c', 'pd fast-charging cable', 'usb-c pd'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/7/77/USB_Type-C_Charging_Cable_for_Apple_MacBook_Pro_%2845718811934%29.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/7/77/USB_Type-C_Charging_Cable_for_Apple_MacBook_Pro_%2845718811934%29.jpg',
      attribution: 'Wikimedia Commons — USB-C PD charging cable (form-factor match)',
    },
  },
  {
    id: 'selfie-stick',
    label: 'Selfie stick',
    match: ['invisible selfie stick', 'selfie stick', 'osmo 1.2m'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/f/fb/Completely_expanded_Selfie_Stick.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/e/e3/Not_expanded_Selfie_Stick.jpg',
      attribution: 'Wikimedia Commons — selfie stick (form-factor match for Osmo invisible stick kit)',
    },
  },
  {
    id: 'pcie-m2-adapter',
    label: 'M.2 NVMe to PCIe adapter',
    match: ['m.2 nvme to pcie', 'expansion card', 'pcie 3.0 x4 expansion'],
    source: {
      hero: 'https://upload.wikimedia.org/wikipedia/commons/c/cb/Adata_XPG_SX8200_Pro_pcie_adapter_view.jpg',
      detail: 'https://upload.wikimedia.org/wikipedia/commons/c/cb/Adata_XPG_SX8200_Pro_pcie_adapter_view.jpg',
      attribution: 'Wikimedia Commons — M.2 NVMe SSD in a PCIe adapter (form-factor match)',
    },
  },
]

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchCatalogPhotoPack(name: unknown, sku?: unknown): CatalogPhotoPack | null {
  const hay = `${normalizeName(name)} ${normalizeName(sku)}`.trim()
  if (!hay) return null
  let best: { pack: CatalogPhotoPack; score: number } | null = null
  for (const pack of CATALOG_PHOTO_PACKS) {
    for (const token of pack.match) {
      const needle = normalizeName(token)
      if (!needle || !hay.includes(needle)) continue
      const score = needle.length
      if (!best || score > best.score) best = { pack, score }
    }
  }
  return best?.pack ?? null
}

export function catalogPhotoRelPath(packId: string, slot: 1 | 2): string {
  return `data/catalog-photos/${packId}/${slot === 1 ? 'hero' : 'detail'}.jpg`
}
