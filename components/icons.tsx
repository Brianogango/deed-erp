'use client'
/**
 * Centralised Font Awesome icon exports.
 * Import individual icons from here – keeps tree-shaking clean and
 * gives one place to swap icons across the whole app.
 */
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconProp, SizeProp } from '@fortawesome/fontawesome-svg-core'
import type { CSSProperties } from 'react'

// ── Solid icons ───────────────────────────────────────────────────────────────
export {
  faUsers, faUserTie,
  faUser, faUserSlash,
} from '@fortawesome/free-solid-svg-icons'
export {
  faMoneyBillWave, faMoneyBill,
  faCreditCard,
  faArrowTrendUp
} from '@fortawesome/free-solid-svg-icons'

export {
  faFolderOpen, faFileLines,
  faFilePdf, faFileSignature, faFileInvoice, faFileInvoiceDollar
} from '@fortawesome/free-solid-svg-icons'

export {
  faDesktop, faPrint,
  faScrewdriverWrench, faWrench,
  faMicrochip, faMemory, faHardDrive,
} from '@fortawesome/free-solid-svg-icons'

export {
  faChartBar, faChartLine, faArrowDown,
} from '@fortawesome/free-solid-svg-icons'

export {
  faBuilding, faBuildingColumns, faWarehouse,
  faBoxesStacked, faBoxOpen, faBox
} from '@fortawesome/free-solid-svg-icons'

export {
  faCartShopping,
  faCashRegister, faBarcode
} from '@fortawesome/free-solid-svg-icons'

export {
  faCamera, faReceipt, faMobileScreenButton, faStore,
  faClipboardList, faInbox, faUpload, faArrowsRotate,
  faFileImport, faFileExport, faFileArrowDown, faIndustry, faPaperclip, faImage,
} from '@fortawesome/free-solid-svg-icons'

export {
  faTruck, faBullseye, faHandshake, faTableCells, faClipboardCheck, faTriangleExclamation,
  faStar, faCircleCheck, faCircleXmark, faCircleExclamation, faShield,
  faMagnifyingGlass, faPlus, faPen, faTrash,
  faChevronDown, faArrowRight, faRotateLeft,
  faEnvelope, faPhone, faLocationDot,
  faPaperPlane,
  faCheck, faXmark, faMinus,
  faEllipsisVertical, faNoteSticky,
  faCar, faUtensils, faLightbulb, faComputer, faDroplet,
  faFlagCheckered, faThumbtack,
} from '@fortawesome/free-solid-svg-icons'

// ── Re-usable wrapper ─────────────────────────────────────────────────────────
interface FaProps {
  icon: IconProp
  className?: string
  style?: CSSProperties
  size?: SizeProp
  fixedWidth?: boolean
  spin?: boolean
}

/** Thin wrapper so we don't repeat FontAwesomeIcon props everywhere. */
export function Fa({ icon, className, style, size, fixedWidth, spin }: FaProps) {
  return (
    <FontAwesomeIcon
      icon={icon}
      className={className}
      style={style as Parameters<typeof FontAwesomeIcon>[0]['style']}
      size={size}
      fixedWidth={fixedWidth}
      spin={spin}
    />
  )
}
