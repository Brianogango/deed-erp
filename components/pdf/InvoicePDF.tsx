// @ts-nocheck
'use client'

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { color: '#6B7280' },
  value: { fontWeight: 'bold' },
  divider: { borderBottom: '1px solid #E5E7EB', marginVertical: 12 },
  table: { marginTop: 8 },
  tableHead: { flexDirection: 'row', backgroundColor: '#F9FAFB', padding: '6 8', borderBottom: '1px solid #E5E7EB' },
  tableRow: { flexDirection: 'row', padding: '5 8', borderBottom: '1px solid #F3F4F6' },
  col1: { flex: 3 },
  col2: { flex: 1, textAlign: 'right' },
  col3: { flex: 1, textAlign: 'right' },
  col4: { flex: 1, textAlign: 'right' },
  total: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  totalLabel: { width: 100, color: '#6B7280' },
  totalValue: { width: 80, textAlign: 'right', fontWeight: 'bold' },
})

interface InvoicePDFProps {
  invoice: {
    ref: string
    date: string
    dueDate?: string
    customerName: string
    customerEmail?: string
    customerPhone?: string
    items: { description: string; qty: number; unitPrice: number; total: number }[]
    subtotal: number
    tax?: number
    total: number
    notes?: string
  }
  companyName?: string
}

export default function InvoicePDF({ invoice, companyName = 'Deed Digital Solutions' }: InvoicePDFProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
          <View>
            <Text style={styles.title}>{companyName}</Text>
            <Text style={styles.label}>Tax Invoice</Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={{ fontSize: 14, fontWeight: 'bold' }}>{invoice.ref}</Text>
            <Text style={styles.label}>Date: {invoice.date}</Text>
            {invoice.dueDate && <Text style={styles.label}>Due: {invoice.dueDate}</Text>}
          </View>
        </View>

        {/* Bill To */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>Bill To</Text>
          <Text>{invoice.customerName}</Text>
          {invoice.customerEmail && <Text style={styles.label}>{invoice.customerEmail}</Text>}
          {invoice.customerPhone && <Text style={styles.label}>{invoice.customerPhone}</Text>}
        </View>

        <View style={styles.divider} />

        {/* Items table */}
        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={styles.col1}>Description</Text>
            <Text style={styles.col2}>Qty</Text>
            <Text style={styles.col3}>Unit Price</Text>
            <Text style={styles.col4}>Total</Text>
          </View>
          {invoice.items.map((item, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.col1}>{item.description}</Text>
              <Text style={styles.col2}>{item.qty}</Text>
              <Text style={styles.col3}>{item.unitPrice.toLocaleString()}</Text>
              <Text style={styles.col4}>{item.total.toLocaleString()}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={{ marginTop: 12 }}>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>KES {invoice.subtotal.toLocaleString()}</Text>
          </View>
          {invoice.tax != null && (
            <View style={styles.total}>
              <Text style={styles.totalLabel}>VAT (16%)</Text>
              <Text style={styles.totalValue}>KES {invoice.tax.toLocaleString()}</Text>
            </View>
          )}
          <View style={[styles.total, { marginTop: 4 }]}>
            <Text style={[styles.totalLabel, { fontWeight: 'bold' }]}>Total</Text>
            <Text style={[styles.totalValue, { fontWeight: 'bold' }]}>KES {invoice.total.toLocaleString()}</Text>
          </View>
        </View>

        {invoice.notes && (
          <View style={{ marginTop: 24 }}>
            <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>Notes</Text>
            <Text style={styles.label}>{invoice.notes}</Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
