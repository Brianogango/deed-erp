import { useMemo, type RefObject } from 'react'
import type { AppState } from './state'

/**
 * Each screen reads a narrow slice of the store, but every slice needs the same
 * thing from the actions: a stable function that calls whatever the provider
 * currently holds. Listing the names instead of writing 296 identical
 * forwarders keeps the bundles honest — a name that is not on AppState will not
 * compile.
 */
function forward<K extends keyof AppState>(store: RefObject<AppState>, keys: readonly K[]): Pick<AppState, K> {
  return Object.fromEntries(
    keys.map(key => [key, (...args: unknown[]) => (store.current![key] as (...a: unknown[]) => unknown)(...args)]),
  ) as Pick<AppState, K>
}

const INVENTORY_ACTIONS = [
    'addProduct', 'publishProductBulk', 'refreshProductCatalog', 'normalizeInventoryTags', 'updateProduct',
    'updateProductPrice', 'archiveProduct', 'unarchiveProduct', 'createTransfer', 'addTransferLine',
    'validateTransfer', 'submitTransfer', 'importOpeningStock', 'intakeProductSerials', 'getStockByLocation',
    'getMonthlyMovements', 'showToast', 'addAuditLog', 'updateSerial', 'releaseSerialToStock',
    'createRefurbishmentJob', 'transferToSell', 'createAdjustment', 'approveAdjustment', 'fixAdjustmentNumbers',
] as const

const SALES_ACTIONS = [
    'createSaleOrder', 'updateSaleOrder', 'confirmSO', 'ensureWaitingDeliveryForSO', 'markQuotationSent',
    'setSaleOrderLock', 'addSOLine', 'removeSOLine', 'moveSOLine', 'addSOSection', 'assignSerialToSOLine',
    'assignSerialsToSOLine', 'unassignSerialFromSOLine', 'addContact', 'createInvoiceFromSO', 'postInvoice',
    'prepareDelivery', 'validateDelivery', 'reverseDelivery', 'markDeliveryNoteGenerated', 'deleteSaleOrder',
    'showToast', 'getStockByLocation', 'resetSOToDraft', 'cancelSO', 'createNewSOVersion', 'getCustomerCreditStatus',
    'issueCreditNoteFromSaleOrder', 'updateDelivery', 'initRelease', 'approveRequest', 'getDocumentPaymentDetails',
    'setDocumentPaymentDetails', 'addBankAccount',
] as const

const REPAIR_ACTIONS = [
    'createRepair', 'updateRepair', 'deleteRepair', 'verifyRepairIntake', 'assignTechnicianToRepair', 'logDiagnosis',
    'stopAtDiagnosis', 'markDiagnosisFeePaid', 'waiveDiagnosisFee', 'markRepairNoCharge', 'generateRepairQuote',
    'approveRepairQuote', 'startRepair', 'markRepairComplete', 'addRepairQAItem', 'completeRepairQA',
    'markPartsArrived', 'scheduleDelivery', 'deliverRepair', 'closeRepairJob', 'createInvoiceFromRepair',
    'consolidateRepairInvoices', 'reviewPortalPayment', 'getVisibleRepairs', 'updateRepairProgress',
    'moveRepairToPreviousProgress', 'requestProcurement', 'correctPartsCount', 'raisePartsPurchaseOrder',
    'markUnrepairable', 'declineQuote', 'returnToCustomer', 'leaveDeviceWithDeed', 'convertRetainedRepairToDonation',
    'convertRetainedRepairToBuyBack', 'createTradeInFromRepair', 'fileWarrantyClaim', 'showToast',
    'appendRepairHistory', 'setModule', 'initRelease', 'addOutsourceJob', 'remindLateOutsourceJobs',
] as const

const SHELL_ACTIONS = [
    'getVisibleRepairs', 'logout', 'markAllNotificationsRead', 'markNotificationRead', 'clearReadNotifications',
    'setModule', 'setProfileImage', 'showToast', 'toggleSidebar', 'updateUser',
] as const

const CRM_ACTIONS = [
    'addContact', 'completeActivity', 'createCompany', 'createContactPerson', 'createCustomerContract',
    'createOpportunity', 'ingestOpportunity', 'deleteCompany', 'deleteContact', 'deleteContactPerson',
    'deleteOpportunity', 'logActivity', 'markOpportunityLost', 'markOpportunityWon', 'moveOpportunityStage',
    'renewCustomerContract', 'terminateCustomerContract', 'updateCompany', 'updateContact', 'updateContactPerson',
    'updateOpportunity', 'showToast',
] as const

const FINANCE_ACTIONS = [
    'addAccount', 'addContact', 'addDepositPayment', 'addOutsourceJob', 'addOutsourceVendor', 'addPOLine',
    'addReturnLine', 'addStatementLine', 'updateStatementLine', 'applyCustomerCreditToInvoice', 'autoMatchStatements',
    'bulkAddPOLines', 'cancelDeposit', 'cancelInvoice', 'completeDeposit', 'confirmPO', 'confirmPurchaseReturn',
    'createBillFromPO', 'createDeposit', 'createManualInvoice', 'importOpeningBalances', 'createPO',
    'createPurchaseReturn', 'createReceiptFromPO', 'deleteInvoice', 'deletePO', 'deleteStatementLine',
    'getCustomerCreditBalance', 'initRelease', 'logReturnPickup', 'matchStatementLine', 'postInvoice',
    'recordOutsourcePayment', 'createOutsourceJobBill', 'registerPayment', 'reverseInvoicePayment',
    'setInvoicePaymentBlocked', 'payExpense', 'payPayrollRun', 'reimburseExpense', 'expenseAction', 'removePOLine',
    'resetInvoiceToDraft', 'restoreCancelledInvoice', 'returnOutsourceJob', 'cancelOutsourceJob', 'updateOutsourceJob', 'deleteOutsourceVendor', 'chargeOutsourceToRepair', 'remindLateOutsourceJobs', 'prepareOutsourceStatements', 'holdOutsourceStatementJob', 'releaseOutsourceJobHold', 'confirmOutsourceStatement', 'revertPOToDraft', 'reviewExpense', 'saveBankRecon',
    'scheduleInvoiceDelivery', 'sendPO', 'setModule', 'showToast', 'submitExpense', 'unmatchStatementLine',
    'updateAccount', 'updateInvoice', 'moveInvoiceLine', 'addInvoiceSection', 'updateOutsourceVendor', 'updatePO',
    'updatePOLine', 'validateReceipt', 'getDocumentPaymentDetails', 'setDocumentPaymentDetails', 'addBankAccount',
    'createCompanyAsset', 'updateCompanyAsset', 'deleteCompanyAsset', 'moveCompanyAsset', 'setCompanyAssetCustodian',
    'setCompanyAssetStatus', 'disposeCompanyAsset', 'writeOffCompanyAsset', 'runCompanyAssetDepreciation',
    'linkSerialToCompanyAsset',
] as const

const HR_ACTIONS = [
    'addRefSop', 'deleteRefSop', 'updateRefSop', 'saveSopDocuments', 'showToast', 'updateUser',
] as const

const DELIVERY_ACTIONS = [
    'addRider', 'advanceJobStatus', 'assignRiderToJob', 'recordCustomerPaidRider', 'createDeliveryJob',
    'deleteDeliveryJob', 'generateWeeklyPay', 'markWeeklyPayPaid', 'scheduleInvoiceDelivery', 'showToast',
    'updateDeliveryJob', 'updateRider',
] as const

const COMMERCE_ACTIONS = [
    'closePOSSession', 'confirmKilimallDispatch', 'createKilimallOrder', 'createKilimallSettlement', 'createPOSOrder',
    'getCustomerCreditStatus', 'openPOSSession', 'reconcileKilimallSettlement', 'matchKilimallSettlementLine',
    'setModule', 'showToast', 'updateKilimallOrder', 'returnKilimallOrder', 'updateKilimallSettlement',
    'updateProduct',
] as const

const AFTER_SALES_ACTIONS = [
    'addContact', 'approveBuyBack', 'approveExchange', 'approveReturn', 'cancelExchange', 'completeExchange',
    'confirmDonation', 'createBuyBack', 'creditBuyBack', 'receiveFreeBuyBack', 'createDonation', 'createExchange', 'createReturnOrder',
    'deleteBuyBack', 'deleteDonation', 'payBuyBack', 'processReturn', 'receiveReturn', 'registerCustomerReturnSerial',
    'rejectReturn', 'cancelWarranty', 'releaseSerialToStock', 'showToast', 'stockBuyBack',
] as const

const OPERATIONS_ACTIONS = [
    'addContact', 'addHoldover', 'addRefurbishmentPart', 'allocateRefurbPart', 'assignRefurbishmentJob',
    'completeRelease', 'completeVerification', 'createContactPerson', 'deleteContactPerson', 'createRefurbishmentJob',
    'createRepair', 'getAvailableSerials', 'getVisibleRepairs', 'markRefurbishmentReady', 'notifyTechPartAvailable',
    'pickRelease', 'removeRefurbishmentPart', 'requestPartFromInventory', 'showToast', 'transferToSell',
    'updateHoldover', 'updateRefurbishmentJob', 'updateRefurbishmentPart', 'updateRepair', 'updateSerial',
    'verifyReleaseItem', 'voidRelease', 'writeOffRefurbishmentJob', 'restoreRefurbishmentJob', 'fixRefurbJobNumbers',
    'fixAdjustmentNumbers', 'intakeTaggedMachines', 'identifyRefurbUnit', 'harvestRefurbishmentJob', 'deleteRefurbishmentRecords',
] as const

/** The per-area action bundles the provider hands to the narrow store contexts. */
export function useViewActions(store: RefObject<AppState>) {
  return useMemo(() => ({
    inventoryActions: forward(store, INVENTORY_ACTIONS),
    salesActions: forward(store, SALES_ACTIONS),
    repairActions: forward(store, REPAIR_ACTIONS),
    shellActions: forward(store, SHELL_ACTIONS),
    crmActions: forward(store, CRM_ACTIONS),
    financeActions: forward(store, FINANCE_ACTIONS),
    hrActions: forward(store, HR_ACTIONS),
    deliveryActions: forward(store, DELIVERY_ACTIONS),
    commerceActions: forward(store, COMMERCE_ACTIONS),
    afterSalesActions: forward(store, AFTER_SALES_ACTIONS),
    operationsActions: forward(store, OPERATIONS_ACTIONS),
  }), [store])
}
