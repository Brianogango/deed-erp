/**
 * Chassis facts copied from official QuickSpecs / PSREF / Apple / Microsoft / ASUS / HP datasheets.
 * Optional panel, GPU, or Thunderbolt variants are omitted (null) rather than guessed.
 */

export type VerifiedChassis = {
  test: RegExp
  screenSize: string | null
  resolution: string | null
  touch: boolean | null
  form: 'x360 convertible' | '2-in-1' | 'clamshell' | null
  graphics: string | null
  ports: string | null
}

export type SkuOverride = {
  test: RegExp
  description: string
}

/** Exact retail SKUs looked up by product number. */
export const LAPTOP_SKU_OVERRIDES: SkuOverride[] = [
  {
    test: /14\s*-?\s*fm0013dx/i,
    description:
      'HP OmniBook X Flip 2-in-1 14-fm0013dx with Intel Core Ultra 5 226V up to 4.5GHz, 16GB LPDDR5x-8533 onboard RAM, 512GB PCIe Gen4 NVMe M.2 SSD, 14-inch 2K multi-touch display (1920 x 1200), 400 nits, Intel AI Boost, integrated Intel Arc 130V GPU (8GB), 1 Thunderbolt 4 USB-C 40Gbps port, 1 USB-C 10Gbps port, 2 USB Type-A 10Gbps ports, HDMI 2.1, headphone/microphone combo, Atmospheric Blue finish, and 1-year warranty.',
  },
  {
    test: /16\s*-?\s*as0043dx/i,
    description:
      'HP OmniBook X Flip 2-in-1 16-as0043dx with Intel Core Ultra 9 288V up to 5.1GHz, Intel AI Boost (48 NPU TOPS), 32GB LPDDR5x-8533 onboard RAM, 2TB PCIe Gen4 NVMe M.2 SSD, 16-inch 3K (2880 x 1800) OLED multi-touch display, 48-120 Hz, Intel Arc 140V GPU, 1 Thunderbolt 4 USB-C 40Gbps port, 1 USB-C 10Gbps port, 2 USB Type-A 10Gbps ports, HDMI 2.1, headphone/microphone combo, Eclipse Gray finish, and 1-year warranty.',
  },
  {
    test: /16-am0073dx|am0073dx/i,
    description:
      'HP OMEN Gaming Laptop 16-am0073dx with Intel Core Ultra 7 255H up to 5.1GHz, 16GB DDR5-5600 RAM, 1TB PCIe Gen4 NVMe M.2 SSD, 16-inch 2K (1920 x 1200) IPS anti-glare display (60-144 Hz, 300 nits), NVIDIA GeForce RTX 5060 Laptop GPU (8GB GDDR7), 1 USB-C 10Gbps (Power Delivery, DisplayPort 1.4), 1 USB-A 10Gbps, 2 USB-A 5Gbps, HDMI 2.1, RJ-45, headphone/microphone combo, Shadow Black finish, and 1-year warranty.',
  },
  {
    test: /15s-fq0007nia|15s-fq007nia|15s-fq007nia/i,
    description:
      'HP Laptop 15s-fq0007nia with Intel Celeron N4120 up to 2.6GHz, 4GB DDR4-2400 RAM, 256GB PCIe NVMe M.2 SSD, 15.6-inch HD (1366 x 768) anti-glare micro-edge display (220 nits), Intel UHD Graphics 600, 1 USB-C 5Gbps, 2 USB-A 5Gbps, HDMI 1.4b, headphone/microphone combo, SD card reader, Natural Silver finish.',
  },
  {
    test: /x1404va/i,
    description:
      'ASUS Vivobook 14 X1404VA with Intel Core 5 120U up to 5.0GHz, 8GB RAM, 512GB PCIe 4.0 NVMe SSD, 14-inch FHD (1920 x 1080) anti-glare non-touch display (250 nits), Intel Graphics, 1 USB-C 5Gbps, 2 USB-A 5Gbps, 1 USB 2.0, HDMI 1.4, 3.5 mm combo jack.',
  },
]

/**
 * Most-specific regex first. Screen size is chassis-standard.
 * Resolution / touch / GPU are set only when the official spec lists a single value for every config.
 */
export const VERIFIED_LAPTOP_CHASSIS: VerifiedChassis[] = [
  { test: /omnibook.*16-as|16\s*-?\s*as0043dx/i, screenSize: '16', resolution: '3K (2880 x 1800) OLED', touch: true, form: '2-in-1', graphics: 'Intel Arc 140V GPU', ports: '1 Thunderbolt 4 USB-C 40Gbps, 1 USB-C 10Gbps, 2 USB-A 10Gbps, HDMI 2.1, headphone/microphone combo' },
  { test: /14\s*-?\s*fm0013dx|omnibook.*fm0013/i, screenSize: '14', resolution: '2K (1920 x 1200)', touch: true, form: '2-in-1', graphics: 'Intel Arc 130V GPU (8GB)', ports: '1 Thunderbolt 4 USB-C 40Gbps, 1 USB-C 10Gbps, 2 USB-A 10Gbps, HDMI 2.1, headphone/microphone combo' },
  { test: /16-am0073dx|omen\s*16.*am0073/i, screenSize: '16', resolution: '2K (1920 x 1200)', touch: false, form: 'clamshell', graphics: 'NVIDIA GeForce RTX 5060 Laptop GPU (8GB GDDR7)', ports: '1 USB-C 10Gbps (Power Delivery, DisplayPort 1.4), 1 USB-A 10Gbps, 2 USB-A 5Gbps, HDMI 2.1, RJ-45, headphone/microphone combo' },
  { test: /omen\s*16-wf|omen\s*16\s*-?\s*wf/i, screenSize: '16.1', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '2 Thunderbolt 4 USB-C (Power Delivery, DisplayPort 1.4), 2 USB-A 5Gbps (1 Sleep and Charge), HDMI 2.1, RJ-45, headphone/microphone combo' },

  { test: /elitebook\s*x360\s*830\s*g8|830\s*g8\s*x360/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: true, form: 'x360 convertible', graphics: 'Intel Iris Xe Graphics', ports: '2 Thunderbolt 4 USB4 (Power Delivery, DisplayPort 1.4), 2 USB-A 5Gbps (1 charging), HDMI 2.0b, headphone/microphone combo' },
  { test: /elitebook\s*x360\s*830\s*g7|x360\s*830\s*g7/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: true, form: 'x360 convertible', graphics: 'Intel UHD Graphics', ports: '2 Thunderbolt 3 USB-C (DisplayPort 1.2), 1 USB-A 3.1 Gen 1, 1 USB-A 3.1 Gen 1 charging, HDMI 1.4b, headphone/microphone combo' },
  { test: /elitebook\s*830\s*g8/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: null, form: 'clamshell', graphics: 'Intel Iris Xe Graphics', ports: '2 Thunderbolt 4 USB4 (Power Delivery, DisplayPort 1.4), 2 USB-A 5Gbps (1 charging), HDMI 2.0b, headphone/microphone combo' },
  { test: /elitebook\s*830\s*g7/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: null, form: 'clamshell', graphics: 'Intel UHD Premium Graphics', ports: '2 Thunderbolt 3 USB-C, 2 USB-A 3.1 Gen 1 (1 charging), HDMI 1.4, headphone/microphone combo' },
  { test: /elitebook\s*830\s*g6/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 620', ports: '1 Thunderbolt USB-C, 2 USB-A 3.1 Gen 1 (1 charging), HDMI 1.4, RJ-45, docking connector, headphone/microphone combo' },
  { test: /elitebook\s*830\s*g5/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 620', ports: '1 Thunderbolt USB-C, 2 USB-A 3.1 Gen 1 (1 charging), HDMI 1.4b, RJ-45, docking connector, headphone/microphone combo' },
  { test: /elitebook\s*725\s*g3/i, screenSize: '12.5', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '1 USB 3.0, 1 USB 3.0 charging, 1 USB-C, DisplayPort, VGA, RJ-45, docking connector, headphone/microphone combo' },
  { test: /elitebook\s*745\s*g6/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: null, form: 'clamshell', graphics: 'AMD Radeon Graphics', ports: '1 USB-C (DisplayPort Alt Mode), 2 USB-A 3.1 Gen 1 (1 charging), HDMI 2.0, RJ-45, docking connector, headphone/microphone combo' },
  { test: /elitebook\s*745\s*g3/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '1 USB 3.0, 1 USB 3.0 charging, 1 USB-C, DisplayPort, VGA, RJ-45, docking connector, headphone/microphone combo' },
  { test: /elitebook\s*845\s*g7/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'AMD Radeon Graphics', ports: '2 USB-C 3.1 Gen 2 (DisplayPort Alt Mode), 2 USB-A 3.1 Gen 1 (1 charging), HDMI 2.0, headphone/microphone combo' },
  { test: /elitebook\s*850\s*g7/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics', ports: '2 Thunderbolt 3 USB-C, 2 USB-A 3.1 Gen 1 (1 charging), HDMI 1.4, headphone/microphone combo' },
  { test: /elitebook\s*840\s*g1/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel HD Graphics 4400', ports: '3 USB 3.0 (1 charging), DisplayPort 1.2, VGA, RJ-45, docking connector, SD reader, headphone/microphone combo' },
  { test: /elitebook\s*820\s*g3/i, screenSize: '12.5', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel HD Graphics 620', ports: '1 USB-A 3.1 Gen 1 charging, 1 USB-A 3.1 Gen 1, 1 USB-C (data/charge, no video), DisplayPort 1.2, VGA, RJ-45, docking connector, headphone/microphone combo' },
  { test: /folio\s*1040\s*g3/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel HD Graphics 520', ports: '2 USB-A 3.0 charging, 1 USB-C charging, HDMI 1.4, docking connector, headphone/microphone combo' },
  { test: /folio\s*1040\s*g2/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: 'DisplayPort 1.2, 2 USB-A 3.0 charging, docking connector, microSD, headphone/microphone combo' },
  { test: /elite\s*dragonfly|elitedragonfly/i, screenSize: '13.5', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel Iris Xe Graphics', ports: '2 Thunderbolt 4 USB4 (Power Delivery, DisplayPort 1.4), 1 USB-A 5Gbps charging, HDMI 2.1, headphone/microphone combo' },

  { test: /probook\s*11\s*g5/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: true, form: 'x360 convertible', graphics: null, ports: '2 USB-A 3.1 Gen 1, 1 USB-C (data and Power Delivery), HDMI, RJ-45, headphone/microphone combo' },
  { test: /probook\s*11\s*g1/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: null, form: 'clamshell', graphics: null, ports: '3 USB 3.0, HDMI 1.4, VGA, RJ-45, headphone/microphone combo' },
  { test: /pro\s*x2\s*612/i, screenSize: '12', resolution: '1920 x 1280', touch: true, form: '2-in-1', graphics: 'Intel HD Graphics 615', ports: '1 USB-C 3.1 (docking, charging, data), 1 USB-A 3.0, microSD, headphone/microphone combo' },
  { test: /x2\s*210\s*g2/i, screenSize: '10.1', resolution: '1280 x 800', touch: true, form: '2-in-1', graphics: 'Intel HD Graphics 400', ports: 'USB 3.0, USB-C (charge/data), micro-HDMI 1.4a, headphone/microphone combo' },
  { test: /probook\s*350\s*g1|\bhp\s*350\s*g1/i, screenSize: '15.6', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: null, ports: 'VGA, HDMI 1.4, 2 USB 3.0, 1 USB 2.0, RJ-45, SD reader, headphone/microphone combo' },
  { test: /probook\s*430\s*g5/i, screenSize: '13.3', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 620', ports: '1 USB-C (DisplayPort 1.2), 2 USB-A 3.1 Gen 1 (1 powered), HDMI 1.4b, VGA, RJ-45, headphone/microphone combo' },
  { test: /probook\s*430\s*g4/i, screenSize: '13.3', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel HD Graphics 620', ports: '1 USB 3.0, 1 USB 2.0 (power), 1 USB-C (data only), HDMI, VGA, RJ-45, headphone/microphone combo' },
  { test: /probook\s*440\s*g8/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '1 USB-C 10Gbps (Power Delivery, DisplayPort 1.4), 3 USB-A 5Gbps (1 charging), HDMI 1.4b, RJ-45, microSD, headphone/microphone combo' },
  { test: /probook\s*450\s*g8/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '1 USB-C 10Gbps (Power Delivery, DisplayPort 1.4), 3 USB-A 5Gbps (1 charging), HDMI 1.4b, RJ-45, microSD, headphone/microphone combo' },
  { test: /probook\s*450\s*g5/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '1 USB-C 3.1 Gen 1 (Power Delivery, DisplayPort), 2 USB 3.0, 1 USB 2.0 (power), HDMI 1.4b, VGA, RJ-45, headphone/microphone combo' },
  { test: /probook\s*470\s*g4/i, screenSize: '17.3', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '1 USB 3.0, 2 USB 2.0, 1 USB-C, HDMI, VGA, RJ-45, headphone/microphone combo' },
  { test: /probook\s*470\s*g3/i, screenSize: '17.3', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '2 USB 3.0, 2 USB 2.0, HDMI, VGA, RJ-45, SD reader, headphone/microphone combo' },
  { test: /probook\s*640\s*g4/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 620', ports: '1 USB-C (Power Delivery, DisplayPort 1.2), 1 USB-A 3.1 Gen 1 charging, 2 USB-A 3.1 Gen 1, HDMI 1.4, VGA, RJ-45, docking connector, headphone/microphone combo' },
  { test: /probook\s*640\s*g3/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel HD Graphics 620', ports: '1 USB-C, 1 USB 3.0, 1 USB 3.0 charging, DisplayPort 1.2, VGA, RJ-45, docking connector, headphone/microphone combo' },
  { test: /probook\s*640\s*g2/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel HD Graphics 520', ports: '1 USB-C charging, 1 USB 3.0, 1 USB 3.0 charging, DisplayPort 1.2, VGA, RJ-45, docking connector, headphone/microphone combo' },
  { test: /probook\s*650\s*g2/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel HD Graphics 520', ports: '1 USB-C, 1 USB 3.0, 1 USB 3.0 charging, DisplayPort 1.2, VGA, RJ-45, docking connector, headphone/microphone combo' },
  { test: /spectre\s*x360.*15/i, screenSize: '15.6', resolution: null, touch: true, form: 'x360 convertible', graphics: null, ports: 'Thunderbolt 3 USB-C (Power Delivery, DisplayPort), HDMI 2.0, USB-A Sleep and Charge, microSD, headphone/microphone combo' },
  { test: /stream\s*11\s*pro\s*g5/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 600', ports: '1 USB-A 3.1 Gen 1, 1 USB 2.0, HDMI 1.4, headphone/microphone combo' },
  { test: /zbook\s*firefly/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: null, form: 'clamshell', graphics: null, ports: '2 Thunderbolt 4 USB4 (Power Delivery, DisplayPort 1.4), 2 USB-A 5Gbps (1 charging), HDMI 2.0b, headphone/microphone combo' },
  { test: /zbook\s*14\s*g2/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '3 USB 3.0, 1 USB 3.0 charging, DisplayPort, VGA, RJ-45, docking connector, headphone/microphone combo' },
  { test: /zbook\s*15\s*g3/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '2 Thunderbolt 3 (DisplayPort 1.2), HDMI 1.4, VGA, 3 USB 3.0 (1 charging), RJ-45, SD UHS-II, headphone/microphone combo' },
  { test: /zbook\s*17\s*g3/i, screenSize: '17.3', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '2 Thunderbolt 3, HDMI, VGA, USB 3.0, RJ-45, SD, headphone/microphone combo' },
  { test: /notebook\s*245\s*g10|245\s*g10/i, screenSize: '14', resolution: null, touch: false, form: 'clamshell', graphics: 'AMD Radeon Graphics', ports: '1 USB-C 5Gbps, 2 USB-A 5Gbps, HDMI 1.4b, headphone/microphone combo' },
  { test: /15s-fq0007nia|15s-fq007nia|15s-fq007nia/i, screenSize: '15.6', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: 'Intel UHD Graphics 600', ports: '1 USB-C 5Gbps, 2 USB-A 5Gbps, HDMI 1.4b, SD reader, headphone/microphone combo' },
  { test: /chromebook\s*11a/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: null, form: 'clamshell', graphics: 'AMD Radeon R4 Graphics', ports: '2 USB-C 3.1 Gen 1 (Power Delivery, DisplayPort), 2 USB 2.0, headphone/microphone combo' },

  { test: /latitude\s*3190/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: true, form: '2-in-1', graphics: null, ports: 'HDMI, 2 USB-A 3.1 Gen 1 (1 PowerShare), headset combo' },
  { test: /latitude\s*3400/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: 'USB-C 3.1 Gen 1 (Power Delivery, DisplayPort), USB-A 3.1 Gen 1, USB-A PowerShare, USB 2.0, HDMI 1.4, VGA, RJ-45, SD, headset combo' },
  { test: /latitude\s*3410/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics', ports: 'USB-C 3.2 Gen 1 (DisplayPort, Power Delivery), USB-A 3.2 Gen 1 PowerShare, USB-A 3.2 Gen 1, USB 2.0, HDMI 1.4, RJ-45, headset combo' },
  { test: /latitude\s*3420/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: 'USB-C (DisplayPort, Power Delivery), USB-A 3.2 Gen 1, USB-A PowerShare, USB 2.0, HDMI 1.4a, RJ-45, microSD, headset combo' },
  { test: /latitude\s*3490/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: 'USB-C (DisplayPort, Power Delivery), HDMI 1.4, VGA, SD, headset combo' },
  { test: /latitude\s*3500/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*3510/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics', ports: 'USB-C 3.2 Gen 1 (DisplayPort, Power Delivery), USB-A PowerShare, USB-A 3.2 Gen 1, USB 2.0, HDMI 1.4, RJ-45, microSD, headset combo' },
  { test: /latitude\s*3520/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: 'USB-C (DisplayPort, Power Delivery), USB-A 3.2 Gen 1, USB-A PowerShare, USB 2.0, HDMI 1.4, RJ-45, microSD, headset combo' },
  { test: /latitude\s*3570/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*5320/i, screenSize: '13.3', resolution: null, touch: null, form: null, graphics: null, ports: '2 Thunderbolt 4 (DisplayPort, USB4, Power Delivery), 1 USB-A 3.2 Gen 1, 1 USB-A PowerShare, HDMI 2.0, microSD, headset combo' },
  { test: /latitude\s*5400/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 620', ports: '3 USB-A 3.1 Gen 1, 1 USB-C 3.1 Gen 2 with DisplayPort, HDMI 1.4b, RJ-45, microSD, headset combo' },
  { test: /latitude\s*5410/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics', ports: 'USB-C 3.2 Gen 2 (DisplayPort), 2 USB-A 3.2 Gen 1, USB-A PowerShare, HDMI 1.4b, RJ-45, microSD, headset combo' },
  { test: /latitude\s*5490/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '3 USB-A 3.1 Gen 1 (1 PowerShare), USB-C with DisplayPort, HDMI, VGA, RJ-45, headset combo' },
  { test: /latitude\s*5501/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*5500/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 620', ports: '3 USB-A 3.1 Gen 1, USB-C 3.1 Gen 2 with DisplayPort, HDMI 1.4b, RJ-45, microSD, headset combo' },
  { test: /latitude\s*5510/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*5520/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*5580/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*7280/i, screenSize: '12.5', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: 'HDMI 1.4, 2 USB-A 3.0 (1 PowerShare), USB-C with DisplayPort, RJ-45, SD, headset combo' },
  { test: /latitude\s*7300/i, screenSize: '13.3', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics', ports: 'USB-C Thunderbolt, HDMI 1.4a, 2 USB-A 3.1 Gen 1 (1 PowerShare), headset combo' },
  { test: /latitude\s*7390/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: null, form: 'clamshell', graphics: null, ports: 'HDMI 1.4, 2 USB-A 3.1 Gen 1 (1 PowerShare), USB-C with DisplayPort, RJ-45, SD, headset combo' },
  { test: /latitude\s*7400/i, screenSize: '14', resolution: null, touch: null, form: null, graphics: null, ports: null },
  { test: /latitude\s*7480/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: 'HDMI 1.4, 2 USB-A 3.0, USB-C with DisplayPort, RJ-45, headset combo' },
  { test: /latitude\s*7490/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: 'HDMI 1.4, 3 USB-A 3.1 Gen 1 (1 PowerShare), USB-C with DisplayPort, RJ-45, SD, headset combo' },
  { test: /latitude\s*e5470/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*e5540/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*e5550/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*e5570/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /latitude\s*e7470/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /precision\s*5530/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /precision\s*7510/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '4 USB 3.0, HDMI, Mini DisplayPort, RJ-45, SD, docking connector, headset combo' },
  { test: /precision\s*7720/i, screenSize: '17.3', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: 'USB 3.0, HDMI, Mini DisplayPort, Thunderbolt 3, RJ-45, SD, docking connector, headset combo' },
  { test: /precision\s*m6800/i, screenSize: '17.3', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /vostro\s*3530/i, screenSize: '15.6', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: 'USB-A 3.2 Gen 1, USB 2.0, USB-C 3.2 Gen 1, HDMI 1.4, RJ-45, headset combo' },
  { test: /xps\s*13\s*9343/i, screenSize: '13.3', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '2 USB 3.0, Mini DisplayPort, headset combo' },
  { test: /xps\s*13\s*9350/i, screenSize: '13.3', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '2 Thunderbolt 3 USB-C, USB-C charging, microSD, headset combo' },

  { test: /100e\s*chromebook|chromebook\s*100e/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 600', ports: null },
  { test: /thinkpad\s*11e/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: null, form: 'clamshell', graphics: null, ports: '2 USB-A 3.1 Gen 1, 1 USB-C 3.1 Gen 1 (Power Delivery, DisplayPort), HDMI 1.4b, RJ-45, microSD, headphone jack' },
  { test: /thinkpad\s*13\b/i, screenSize: '13.3', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '3 USB 3.0 (1 Always On), 1 USB-C, HDMI, OneLink+, SD reader, headphone/microphone combo' },
  { test: /thinkpad\s*e560/i, screenSize: '15.6', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '3 USB 3.0 (1 Always On), VGA, HDMI, RJ-45, SD reader, OneLink, headphone/microphone combo' },
  { test: /thinkpad\s*e570/i, screenSize: '15.6', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '2 USB 3.0, 1 USB 2.0 Always On, VGA, HDMI, RJ-45, SD reader, headphone/microphone combo' },
  { test: /thinkpad\s*l470/i, screenSize: '14', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '3 USB-A 3.1 Gen 1 (1 Always On), VGA, Mini DisplayPort, RJ-45, docking connector, SD reader' },
  { test: /thinkpad\s*l490/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics', ports: '1 USB-A 3.1 Gen 1, 1 USB-A Always On, 1 USB-C 3.1 Gen 1 (Power Delivery, DisplayPort), 1 USB-C 3.1 Gen 2 (Power Delivery, DisplayPort), HDMI 1.4b, RJ-45, microSD, headphone/microphone combo' },
  { test: /thinkpad\s*l540/i, screenSize: '15.6', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '1 USB 3.0 Always On, 3 USB 2.0, VGA, Mini DisplayPort, RJ-45, docking connector, SD reader, headphone/microphone combo' },
  { test: /thinkpad\s*l560/i, screenSize: '15.6', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: 'USB 3.0, VGA, Mini DisplayPort, RJ-45, docking connector, SD reader' },
  { test: /thinkpad\s*p51/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '4 USB-A 3.1 (1 Always On), USB-C Thunderbolt, HDMI 1.4b, Mini DisplayPort, RJ-45, SD, headphone jack' },
  { test: /thinkpad\s*t14s\s*gen\s*2|t14s\s*gen\s*2/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel Iris Xe Graphics', ports: '2 Thunderbolt 4 USB4 (Power Delivery, DisplayPort 1.4a), 1 USB-A 3.2 Gen 1, 1 USB-A Always On, HDMI 2.0, headphone/microphone combo' },
  { test: /thinkpad\s*t14\s*gen\s*2/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '2 Thunderbolt 4 USB4 (Power Delivery, DisplayPort 1.4a), 1 USB-A 3.2 Gen 1, 1 USB-A Always On, HDMI 2.0, microSD, headphone/microphone combo' },
  { test: /thinkpad\s*t14s\s*gen\s*1/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '2 USB-C (Power Delivery, DisplayPort), 2 USB-A 5Gbps (1 Always On), HDMI, Ethernet extension, headphone/microphone combo' },
  { test: /thinkpad\s*t14s/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },
  { test: /thinkpad\s*t470/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '3 USB-A 3.1 Gen 1 (1 Always On), USB-C Thunderbolt 3, HDMI 1.4b, RJ-45, docking connector, SD reader' },
  { test: /thinkpad\s*t480s/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '2 USB-A 3.1 Gen 1 (1 Always On), 1 USB-C 3.1 Gen 1 (Power Delivery, DisplayPort), 1 USB-C Thunderbolt 3, HDMI 1.4b, RJ-45, SD reader, headphone/microphone combo' },
  { test: /thinkpad\s*t495s/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: null, form: 'clamshell', graphics: 'AMD Radeon Graphics', ports: '1 USB-A Always On, 1 USB-A 3.1 Gen 2, 2 USB-C 3.1 Gen 2 (Power Delivery, DisplayPort 1.4), HDMI 2.0, headphone/microphone combo' },
  { test: /thinkpad\s*t560/i, screenSize: '15.6', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: '3 USB 3.0 (1 Always On), Mini DisplayPort, HDMI, RJ-45, docking connector, SD reader, headphone/microphone combo' },
  { test: /thinkpad\s*x1\s*carbon\s*gen\s*7/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 620', ports: '1 USB-A 3.1 Gen 1, 1 USB-A Always On, 2 Thunderbolt 3 USB-C, HDMI 1.4b, headphone/microphone combo' },
  { test: /thinkpad\s*x1\s*carbon/i, screenSize: '14', resolution: null, touch: null, form: 'clamshell', graphics: 'Intel UHD Graphics 620', ports: '2 USB-A 3.1 Gen 1 (1 Always On), 2 Thunderbolt 3 USB-C, HDMI 1.4b, microSD, headphone/microphone combo' },
  { test: /thinkpad\s*x1\s*yoga/i, screenSize: '14', resolution: null, touch: true, form: 'x360 convertible', graphics: 'Intel UHD Graphics 620', ports: '2 Thunderbolt 3 USB-C, USB-A, HDMI, headphone jack' },
  { test: /thinkpad\s*x13/i, screenSize: '13.3', resolution: null, touch: null, form: 'clamshell', graphics: null, ports: null },

  { test: /macbook\s*air.*a2337|macbook\s*air.*m1/i, screenSize: '13.3', resolution: '2560 x 1600', touch: false, form: 'clamshell', graphics: null, ports: '2 Thunderbolt / USB 4, 3.5 mm headphone jack' },
  { test: /macbook\s*air.*201[57]/i, screenSize: '13.3', resolution: '1440 x 900', touch: false, form: 'clamshell', graphics: 'Intel HD Graphics 6000', ports: '2 USB 3, 1 Thunderbolt 2, MagSafe 2, SDXC, 3.5 mm headphone jack' },
  { test: /surface\s*laptop\s*go/i, screenSize: '12.4', resolution: '1536 x 1024', touch: true, form: 'clamshell', graphics: 'Intel UHD Graphics', ports: '1 USB-C, 1 USB-A, 3.5 mm headphone jack, Surface Connect' },
  { test: /surface\s*pro/i, screenSize: '12.3', resolution: '2736 x 1824', touch: true, form: '2-in-1', graphics: null, ports: '1 USB 3.0, Mini DisplayPort, 3.5 mm headphone jack, microSDXC, Surface Connect' },
  { test: /x1404va|vivobook\s*14\s*x1404/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null, ports: '1 USB-C 5Gbps, 2 USB-A 5Gbps, 1 USB 2.0, HDMI 1.4, 3.5 mm combo jack' },
  { test: /e410/i, screenSize: '14', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '1 USB-C 5Gbps, 1 USB-A 5Gbps, 1 USB 2.0, HDMI 1.4, headphone jack' },
  { test: /travelmate\s*p645/i, screenSize: '14', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: '3 USB 3.0 (1 charging), HDMI, VGA, RJ-45, headphone jack, microphone jack, ProDock II' },
  { test: /portege\s*x30l/i, screenSize: '13.3', resolution: null, touch: false, form: 'clamshell', graphics: null, ports: null },
  { test: /portege\s*x30-e/i, screenSize: '13.3', resolution: null, touch: false, form: 'clamshell', graphics: 'Intel UHD Graphics 620', ports: '2 USB-C 3.1 (Thunderbolt 3, Power Delivery, DisplayPort), 1 USB-A 3.0 Sleep and Charge, HDMI, microSD, headset combo' },
]

export function verifiedChassisFor(name: string): VerifiedChassis | null {
  for (const row of VERIFIED_LAPTOP_CHASSIS) {
    if (row.test.test(name)) return row
  }
  return null
}

export function skuOverrideFor(name: string): string | null {
  for (const row of LAPTOP_SKU_OVERRIDES) {
    if (row.test.test(name)) return row.description
  }
  return null
}
