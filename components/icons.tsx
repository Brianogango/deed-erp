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
  faUsers, faUserCircle, faUserTie, faUserGroup,
  faUser, faUserPlus, faUserCheck, faUserClock, faUserSlash,
} from '@fortawesome/free-solid-svg-icons'

export {
  faCalendarMinus, faCalendarCheck, faCalendarXmark, faCalendarDays,
  faCalendarPlus,
} from '@fortawesome/free-solid-svg-icons'

export {
  faMoneyBillWave, faMoneyBill, faMoneyBillTrendUp,
  faCreditCard, faDollarSign,
  faArrowTrendUp, faArrowTrendDown,
} from '@fortawesome/free-solid-svg-icons'

export {
  faFolderOpen, faFolder, faFile, faFileAlt, faFileLines,
  faFilePdf, faFileSignature, faFileInvoice, faFileInvoiceDollar, faFileCircleCheck,
} from '@fortawesome/free-solid-svg-icons'

export {
  faLaptop, faDesktop, faPrint, faServer,
  faScrewdriverWrench, faWrench, faToolbox,
  faMicrochip, faMemory, faHardDrive,
} from '@fortawesome/free-solid-svg-icons'

export {
  faChartBar, faChartLine, faChartPie, faChartSimple,
  faArrowUp, faArrowDown,
} from '@fortawesome/free-solid-svg-icons'

export {
  faBuilding, faBuildingColumns, faWarehouse,
  faBoxesStacked, faBoxOpen, faBox, faCubes,
} from '@fortawesome/free-solid-svg-icons'

export {
  faShoppingCart, faCartShopping, faBagShopping,
  faCashRegister, faBarcode, faTag,
} from '@fortawesome/free-solid-svg-icons'

export {
  faCamera, faReceipt, faMobileScreenButton, faStore,
  faClipboardList, faInbox, faUpload, faArrowsRotate,
  faFileImport, faFileExport, faFileArrowDown, faFileArrowUp,
  faLink, faIndustry, faPaperclip, faImage,
} from '@fortawesome/free-solid-svg-icons'

export {
  faTruck, faGlobe, faBriefcase, faBullseye,
  faAddressBook, faHandshake, faTableCells,
  faScaleBalanced, faClipboardCheck, faTriangleExclamation,
  faTrophy, faPercent, faBook, faLandmark,
  faStar, faCircleCheck, faCircleXmark, faCircleExclamation,
  faCheckCircle, faTimesCircle,
  faBell, faGear, faKey, faLock, faShield,
  faMagnifyingGlass, faPlus, faPen, faTrash, faEye, faEyeSlash,
  faChevronDown, faChevronRight, faChevronLeft,
  faArrowLeft, faArrowRight, faRotateLeft,
  faEnvelope, faPhone, faLocationDot,
  faPaperPlane, faDownload, faPrint as faPrintIcon,
  faCheck, faXmark, faMinus,
  faEllipsisVertical, faBars, faGrip,
  faFire, faSun, faSnowflake, faNoteSticky, faListCheck,
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
