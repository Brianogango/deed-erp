import type { StoreLeaveType } from '@/lib/leave-utils'
import type { LocationId } from './core'

export interface Department {
  id: string
  name: string
  managerEmployeeId?: string
  description: string
}

export interface Employee {
  id: string
  employeeNo: string
  fullName: string
  /** Personal email. */
  email: string
  /** Company mailbox; notifications prefer this over `email`. */
  workEmail?: string
  phone: string
  nationalId: string
  kraPin: string
  nssfNumber?: string
  gender?: 'male' | 'female' | ''
  departmentId: string
  jobTitle: string
  /** Holds the SHA / SHIF number (stored in the old `shift` column; nothing uses it as a work shift). */
  shift?: string
  managerEmployeeId?: string
  startDate: string
  status: 'active' | 'on_leave' | 'exited'
  userId?: string
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  bankName?: string
  bankAccount: string
  /** How salary is paid; drives the bank vs M-Pesa salary files. */
  paymentMode?: 'bank' | 'mpesa' | 'cash'
  mpesaNumber?: string
  /** Last working day, set when the employee exits. */
  exitDate?: string
  exitReason?: string
  exitNotes?: string
  probationEndDate?: string
  onboardingChecklist?: EmployeeChecklistItem[]
  exitChecklist?: EmployeeChecklistItem[]
}

export interface EmployeeChecklistItem {
  id: string
  label: string
  done: boolean
  doneAt?: string
  /** Template key, instructions, owner, due date and shortcut for tasks built from a template. */
  key?: string
  instructions?: string
  owner?: 'hr' | 'it' | 'finance' | 'manager' | 'employee'
  dueDate?: string
  link?: 'create_login' | 'welcome_email' | 'assets' | 'training' | 'create_mailbox' | 'disable_mailbox'
}

export type JobStatus = 'open' | 'closed' | 'draft'

export type CandidateStage = 'applied' | 'screening' | 'interview' | 'offered' | 'hired' | 'rejected'

export interface JobPosting {
  id: string; title: string; departmentId: string; location: string; type: 'full_time' | 'part_time' | 'contract'; status: JobStatus; postedDate: string; closingDate?: string; description: string;
  /** Number of positions to fill; defaults to 1. */
  openings?: number;
}

export interface CandidateInterview {
  id: string
  scheduledAt: string
  mode: 'in_person' | 'video' | 'phone'
  interviewer: string
  location?: string
  status: 'scheduled' | 'done' | 'cancelled'
  /** 1 to 5, set after the interview. */
  rating?: number
  feedback?: string
}

export interface CandidateOffer {
  salary: number
  startDate: string
  offeredDate: string
  status: 'pending' | 'accepted' | 'declined'
  notes?: string
  probationMonths?: number
  reportsTo?: string
  /** Last day the candidate can accept. */
  validUntil?: string
  additionalTerms?: string
}

export interface CandidateCommunication {
  id: string
  kind: 'interview_invite' | 'rejection' | 'offer'
  at: string
  to: string
}

export interface Candidate {
  id: string; jobId: string; firstName: string; lastName: string; email: string; phone: string; stage: CandidateStage; appliedDate: string; resumeUrl?: string; notes?: string;
  source?: string
  /** Overall rating, 1 to 5. */
  rating?: number
  stageChangedDate?: string
  rejectionReason?: string
  interviews?: CandidateInterview[]
  offer?: CandidateOffer
  /** CV uploaded to the server (see /api/hr-documents/[candidateId]/file). */
  resumeFile?: { name: string; size: number; type: string }
  hiredEmployeeId?: string
  /** Emails sent to the candidate from the ERP. */
  communications?: CandidateCommunication[]
}

export type TrainingStatus = 'not_started' | 'in_progress' | 'completed'

export interface TrainingProgram {
  id: string; title: string; description: string; mandatoryForNewHires: boolean; durationDays: number;
}

export interface EmployeeTraining {
  id: string; employeeId: string; trainingId: string; status: TrainingStatus; enrolledDate: string; completedDate?: string; score?: number;
}

export interface Contract {
  id: string
  employeeId: string
  type: 'permanent' | 'fixed_term' | 'consultant'
  startDate: string
  endDate?: string
  grossSalary: number
  benefits: string[]
  signedDate?: string
  status: 'draft' | 'active' | 'expired'
}

export interface LeaveBalance {
  id: string
  employeeId: string
  leaveType: StoreLeaveType
  year: number
  entitlement: number
  used: number
  pending: number
  carryForward: number  // always 0 for annual (use-it-or-lose-it policy)
}

export interface LeaveRequest {
  id: string
  ref: string
  employeeId: string
  employeeName: string
  leaveType: StoreLeaveType
  startDate: string
  endDate: string
  days: number
  reason: string
  status: 'pending_hr' | 'approved' | 'rejected' | 'cancelled'
  submittedDate: string
  hrApprovalBy?: string
  hrDecisionDate?: string
  reviewNotes?: string
  submittedByUserId?: string
  isSystemGenerated?: boolean  // true for december_closure auto-applied by HR
}

export interface HRDocument {
  id: string
  employeeId: string
  type: 'contract' | 'nda' | 'id_copy' | 'certification' | 'work_permit' | 'other'
  title: string
  expiryDate?: string
  visibility: 'hr_only' | 'hr_finance' | 'employee_visible'
  status: 'active' | 'expiring' | 'expired'
  // File upload metadata
  fileName?: string
  fileSize?: number        // bytes
  fileType?: string        // MIME type
  fileDataUrl?: string     // base64 data URL (demo only)
  uploadedByUserId?: string
  uploadedByName?: string
  uploadedDate?: string
  notes?: string
}

export interface PayrollLine {
  employeeId: string
  employeeName: string
  basicSalary: number
  allowances: number
  deductions: number
  statutoryDeductions?: number
  salaryAdvanceDeductions?: Array<{ advanceId: string; ref: string; amount: number; remainingAfter: number }>
  netPay: number
  /** Daily-rate staff: the approved days and the rate the basic was built from. */
  daysWorked?: number
  dailyRate?: number
  /** Monthly staff: approved unpaid leave days taken off the basic. */
  unpaidLeaveDays?: number
}

export interface PayrollRun {
  id: string
  ref: string
  month: string
  year: number
  status: 'draft' | 'pending_approval' | 'approved' | 'posted'
  lines: PayrollLine[]
  totalGross: number
  totalDeductions: number
  totalNet: number
  postedJournalId?: string
}

export interface EmployeeAssetAssignment {
  id: string
  employeeId: string
  employeeName: string
  productId: string
  productName: string
  serialId?: string
  serialNumber?: string
  qty: number
  assignedDate: string
  status: 'assigned' | 'returned' | 'reassigned'
  returnedDate?: string
  returnLocation?: LocationId
  previousAssignmentId?: string
  acknowledgedByEmployee: boolean
  acknowledgmentDate?: string
  handoverCondition: 'new' | 'good' | 'fair' | 'damaged'
  handoverNotes?: string
  returnCondition?: 'good' | 'fair' | 'damaged'
  returnInspectionNotes?: string
}

export interface Payslip {
  id: string
  ref: string
  payrollRunId: string
  employeeId: string
  employeeName: string
  month: string
  year: number
  grossPay: number
  deductions: number
  salaryAdvanceDeductions?: Array<{ advanceId: string; ref: string; amount: number; remainingAfter: number }>
  netPay: number
  status: 'draft' | 'published'
  paymentStatus?: 'pending' | 'paid'
  paidAt?: string
  paymentReference?: string
  generatedDate: string
  downloadUrl?: string
}

export interface SalaryAdvance {
  id: string
  ref: string
  employeeId: string
  employeeName: string
  employeeNo?: string
  departmentId?: string
  jobTitle?: string
  amount: number
  paymentTerms: 'payroll_deduction' | 'manual_repayment'
  repaymentMonths: number
  repaymentStartPeriod: string
  monthlyDeduction: number
  amountRecovered: number
  outstandingAmount: number
  deductions: Array<{ payrollRunId: string; payslipId?: string; period: string; amount: number; date: string }>
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'repaid' | 'cancelled'
  requestedDate: string
  neededByDate?: string
  approvedByUserId?: string
  approvedByName?: string
  decisionDate?: string
  decisionNote?: string
  paidDate?: string
  repaymentStartMonth?: string
  createdByUserId?: string
}

// ── HR SOP types ──────────────────────────────────────────────────────────────
export type SOPCategory = 'recruitment' | 'onboarding' | 'leave' | 'payroll' | 'offboarding' | 'conduct' | 'general'

export interface HRSOP {
  id: string; title: string; category: SOPCategory; content: string
  status: 'active' | 'draft'; version: string
  createdByName: string; createdAt: string; updatedAt: string
}

// ── Performance Target types ──────────────────────────────────────────────────
export type PerfStatus = 'on_track' | 'at_risk' | 'achieved' | 'missed'

export type PerfPeriod = 'monthly' | 'quarterly' | 'annual'

export interface PerformanceTarget {
  id: string; employeeId: string; employeeName: string
  metric: string; description: string
  targetValue: number; currentValue: number; unit: string
  period: PerfPeriod; periodLabel: string; dueDate: string
  status: PerfStatus; createdByName: string; createdAt: string
}

// ── Reference SOPs (My Documents) ───────────────────────────────────────────
export type RefSOPCategory = 'sales' | 'repair' | 'credit' | 'hr'

export interface RefSOP {
  id: string
  category: RefSOPCategory
  title: string
  content: string
  updatedAt: string
  createdByName: string
  fileName?: string
  fileData?: string
}
