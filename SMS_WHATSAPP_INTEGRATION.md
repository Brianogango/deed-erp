# SMS & WhatsApp Integration Guide

## Overview

Comprehensive SMS and WhatsApp notification system integrated throughout the Repair module with automatic fallback and intelligent routing.

---

## ✅ Features Implemented

### 1. Unified Notification Service

**Component:** `lib/integrations/notifications.ts`

**Features:**
- **Smart Routing:** WhatsApp first, SMS fallback
- **Development Mode:** Logs to console (no charges)
- **Production Mode:** Sends real messages
- **Phone Formatting:** Automatic international format
- **Batch Sending:** Multiple recipients support
- **Priority Levels:** Low, Normal, High, Urgent

### 2. Integrated Scenarios

All repair notifications now use SMS/WhatsApp:

| Scenario | Trigger | Recipient | Priority |
|----------|---------|-----------|----------|
| Progress Update | Technician updates status | Customer | Normal |
| Parts Request | Technician requests parts | Procurement Team | Based on urgency |
| Parts Delay | Parts not available | Customer | Normal |
| Quote Sent | Quote generated | Customer | High |
| Quote Declined | Customer declines | Customer | Normal |
| Unrepairable | Device cannot be fixed | Customer | High |
| Ready for Pickup | Repair complete | Customer | High |
| Delivered | Device handed over | Customer | Normal |

---

## Setup Instructions

### Option 1: WhatsApp Business API (Recommended)

**Requirements:**
- Facebook Business Account
- WhatsApp Business API access
- Verified phone number

**Steps:**

1. **Get WhatsApp Credentials:**
   ```
   Visit: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
   ```

2. **Set Environment Variables:**
   ```bash
   WHATSAPP_PHONE_NUMBER_ID=123456789012345
   WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxx
   WHATSAPP_BUSINESS_ACCOUNT_ID=123456789012345
   ```

3. **Test:**
   ```bash
   # In development, messages log to console
   NODE_ENV=development npm run dev

   # In production, messages send
   NODE_ENV=production npm start
   ```

**Advantages:**
- ✓ No per-message charges (WhatsApp is free)
- ✓ Rich formatting support
- ✓ Read receipts
- ✓ High delivery rates
- ✓ Customer can reply directly

### Option 2: Twilio (SMS + WhatsApp)

**Requirements:**
- Twilio account
- Phone number with SMS enabled
- Funding in Twilio account

**Steps:**

1. **Create Twilio Account:**
   ```
   Visit: https://www.twilio.com/try-twilio
   ```

2. **Get Credentials:**
   - Account SID (from console dashboard)
   - Auth Token (from console dashboard)
   - Buy a phone number with SMS capability

3. **Set Environment Variables:**
   ```bash
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_PHONE_NUMBER=+15551234567
   ```

4. **Optional: Enable WhatsApp:**
   ```bash
   # If using Twilio for WhatsApp too
   TWILIO_WHATSAPP_NUMBER=whatsapp:+15551234567
   ```

**Pricing:**
- SMS: ~$0.0075 per message (varies by country)
- WhatsApp: $0.005 per message (business-initiated)

**Advantages:**
- ✓ Easy setup
- ✓ Reliable delivery
- ✓ SMS + WhatsApp in one service
- ✓ Good documentation
- ✓ Pay-as-you-go

### Option 3: Hybrid Setup (Best Practice)

Use both services for maximum reliability:

```bash
# WhatsApp Business (primary)
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxx

# Twilio SMS (fallback)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+15551234567
```

**Flow:**
1. Try WhatsApp (free, no charges)
2. If WhatsApp fails, use SMS (charged)
3. If both fail, log error

---

## Phone Number Format

### Automatic Formatting

The system automatically formats phone numbers:

```typescript
// Input formats (all work):
"0722123456"      → "+254722123456"
"722123456"       → "+254722123456"
"254722123456"    → "+254722123456"
"+254722123456"   → "+254722123456"

// For other countries:
"+1234567890"     → "+1234567890"
"+44123456789"    → "+44123456789"
```

### Validation

- Must include country code (or default to +254 Kenya)
- Removes spaces, dashes, parentheses
- Validates international format

---

## Notification Templates

### 1. Progress Update

```
Hi {CustomerName},

{StatusMessage}

Repair: {RepairRef}
Device: {DeviceName}

- Deed Technologies
www.deed.co.ke
```

**Example:**
```
Hi John Doe,

Your device is currently being repaired by our technician.

Repair: REP-2024-0123
Device: Dell Latitude 5520

- Deed Technologies
www.deed.co.ke
```

### 2. Parts Request (to Procurement)

```
🔧 PARTS REQUEST - {URGENCY}

Repair: {RepairRef}
Requested by: {TechnicianName}

PARTS NEEDED:
- {PartName} x{Qty} (Est. KES {Cost})
...

TOTAL ESTIMATE: KES {Total}

Notes: {Notes}

Please process this request ASAP.

- Deed ERP
```

### 3. Quote Notification

```
Hi {CustomerName},

Your repair quotation is ready!

Repair: {RepairRef}
Device: {DeviceName}
Total: KES {Total} (incl. VAT)

View & Accept Online:
{QuoteURL}

Reply with "YES" to approve or "NO" to decline.

- Deed Technologies
```

### 4. Unrepairable Notification

```
Hi {CustomerName},

After thorough diagnosis, we regret to inform you that your {DeviceName} cannot be repaired due to: {Reason}

Your device is ready for return. No charges apply.

Repair: {RepairRef}
Device: {DeviceName}

- Deed Technologies
www.deed.co.ke
```

---

## Usage in Code

### Send Simple Notification

```typescript
import { sendNotification } from '@/lib/integrations/notifications'

await sendNotification({
  to: '+254722123456',
  message: 'Your device is ready for pickup!',
  priority: 'high',
  channel: 'auto' // tries WhatsApp, falls back to SMS
})
```

### Send Repair Notification

```typescript
import { sendRepairNotification } from '@/lib/integrations/notifications'

await sendRepairNotification(
  'John Doe',              // customerName
  '0722123456',            // customerPhone
  'REP-2024-0123',        // repairRef
  'Dell Laptop',          // deviceName
  'Your device is ready', // message
  { priority: 'high' }    // options
)
```

### Send Quote

```typescript
import { sendQuoteNotification } from '@/lib/integrations/notifications'

await sendQuoteNotification(
  'John Doe',
  '0722123456',
  'REP-2024-0123',
  'Dell Laptop',
  45000, // total amount
  'https://erp.deed.co.ke/portal/quotes/abc123' // optional portal URL
)
```

### Send Procurement Request

```typescript
import { sendProcurementNotification } from '@/lib/integrations/notifications'

await sendProcurementNotification(
  'REP-2024-0123',
  'Jane Smith',
  [
    { productName: 'LCD Screen', qty: 1, estimatedCost: 15000 },
    { productName: 'Battery', qty: 1, estimatedCost: 3000 }
  ],
  'urgent',
  'Customer waiting, need ASAP'
)
```

### Batch Send

```typescript
import { sendBatchNotifications } from '@/lib/integrations/notifications'

const results = await sendBatchNotifications([
  { phone: '0722111111', message: 'Repair 1 ready' },
  { phone: '0722222222', message: 'Repair 2 ready' },
  { phone: '0722333333', message: 'Repair 3 ready' }
], { priority: 'high' })

// Check results
results.forEach(r => {
  console.log(`${r.phone}: ${r.success ? 'Sent' : 'Failed'}`)
})
```

---

## Testing

### Development Mode (Console Only)

```bash
# No charges, logs to console
NODE_ENV=development npm run dev
```

**Console Output:**
```
═══════════════════════════════════════════
📱 NOTIFICATION (Development Mode)
═══════════════════════════════════════════
To: +254722123456
Priority: high
-------------------------------------------
Hi John Doe,

Your device is ready for pickup!

Repair: REP-2024-0123
Device: Dell Laptop

- Deed Technologies
www.deed.co.ke
═══════════════════════════════════════════
```

### Production Mode (Real Sending)

```bash
# Sends actual SMS/WhatsApp
NODE_ENV=production npm start
```

### Test Specific Scenarios

1. **Progress Update:**
   - Open repair
   - Click "Update Progress"
   - Select status
   - Check "Notify customer"
   - Submit

2. **Parts Request:**
   - Open diagnosed repair
   - Click "Request Parts"
   - Add parts
   - Submit
   - Check procurement team phone

3. **Quote:**
   - Generate quote
   - Click "Send Quote"
   - Check customer phone

4. **Unrepairable:**
   - Click "Mark Unrepairable"
   - Enter reason
   - Submit
   - Check customer phone

---

## Monitoring & Logs

### Success Indicators

**Toast Messages:**
- ✓ "Status updated • Customer notified via WHATSAPP"
- ✓ "Quote sent via SMS"
- ✓ "Procurement request sent"

**Console Logs:**
```typescript
// Development mode
console.log('📱 NOTIFICATION (Development Mode)')

// Production mode (on error)
console.error('Notification error:', error)
```

### Error Handling

**Common Errors:**

1. **"WhatsApp API not configured"**
   - Solution: Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN

2. **"SMS not configured"**
   - Solution: Set Twilio credentials

3. **"Invalid phone number format"**
   - Solution: Ensure phone includes country code

4. **"WhatsApp failed, falling back to SMS"**
   - Info: Normal behavior, SMS will be used

**Error Messages:**
```typescript
{
  success: false,
  error: "WhatsApp API not configured"
}
```

---

## Configuration Summary

### Complete .env Setup

```bash
# ─── Authentication ───────────────────────────────────────
AUTH_SECRET=your-secret-key

# ─── WhatsApp Business API ────────────────────────────────
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxx
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789012345

# ─── Twilio (SMS) ─────────────────────────────────────────
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+15551234567

# ─── Notification Recipients ──────────────────────────────
PROCUREMENT_TEAM_PHONE=+254700000000
SALES_TEAM_EMAIL=sales@deed.co.ke

# ─── Customer Portal ──────────────────────────────────────
NEXT_PUBLIC_APP_URL=https://erp.deed.co.ke

# ─── Environment ──────────────────────────────────────────
NODE_ENV=production
```

---

## Best Practices

### 1. Phone Number Collection

**At Intake:**
```typescript
// Always collect with country code
customerPhone: "+254722123456"

// Or use formatter
import { formatPhoneNumber } from '@/lib/integrations/notifications'
const formatted = formatPhoneNumber("0722123456")
```

### 2. Message Length

- **SMS:** 160 characters per message
- **WhatsApp:** 4096 characters max
- **Recommendation:** Keep under 160 for SMS compatibility

### 3. Timing

**Best times to send:**
- ✓ 8 AM - 8 PM local time
- ✗ Avoid late night messages
- ✓ Urgent messages: anytime

### 4. Frequency

**Limits:**
- Max 1 message per status change
- Max 3 messages per day per customer
- No spam/marketing

### 5. Cost Optimization

**Free Options:**
- Use WhatsApp Business (free)
- Batch notifications
- Combine updates when possible

**Paid Options:**
- SMS: Use for high-priority only
- Monitor usage
- Set budget alerts

---

## Troubleshooting

### WhatsApp Not Sending

**Check:**
1. ✓ Credentials are correct
2. ✓ Phone number verified
3. ✓ Business account approved
4. ✓ Message templates approved (if using templates)
5. ✓ Customer opted in

**Solution:**
```bash
# Test credentials
curl -X GET "https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

### SMS Not Sending

**Check:**
1. ✓ Twilio account has funds
2. ✓ Phone number is SMS-enabled
3. ✓ Recipient number is valid
4. ✓ Not on DND list
5. ✓ Country is supported

**Solution:**
```bash
# Check balance
curl -X GET "https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Balance.json" \
  -u "${ACCOUNT_SID}:${AUTH_TOKEN}"
```

### Messages Delayed

**Reasons:**
- Network congestion
- Rate limiting
- Queue backlog

**Solution:**
- Check service status
- Implement retry logic
- Use priority levels

### Invalid Phone Numbers

**Common Issues:**
- Missing country code
- Extra characters
- Landline numbers

**Solution:**
```typescript
// Use formatter
const formatted = formatPhoneNumber(phone)

// Validate
if (!formatted.startsWith('+')) {
  throw new Error('Invalid phone number')
}
```

---

## Cost Estimates

### WhatsApp Business API

**Pricing:** FREE for business-initiated conversations
- 1,000 free conversations/month
- Additional: $0.005 - $0.05 per conversation (varies by country)

**Kenya Rates:**
- First 1,000 conversations: FREE
- Beyond 1,000: ~$0.016 per conversation

**Estimated Monthly Cost (1,000 repairs):**
- ~1,000 notifications
- First 1,000: FREE
- Total: **$0/month**

### Twilio SMS

**Pricing:** Pay per message
- Kenya SMS: $0.0478 per message
- US SMS: $0.0079 per message

**Estimated Monthly Cost (1,000 repairs):**
- ~2,000 messages (2 per repair avg)
- 2,000 × $0.0478
- Total: **$95.60/month**

### Hybrid (Recommended)

**Setup:** WhatsApp + SMS fallback

**Estimated Monthly Cost (1,000 repairs):**
- 950 via WhatsApp: FREE
- 50 via SMS fallback: $2.39
- Total: **$2.39/month**

**Savings:** 97.5% vs SMS-only

---

## Production Checklist

Before going live:

- [ ] Set `NODE_ENV=production`
- [ ] Configure WhatsApp credentials
- [ ] Configure Twilio credentials (fallback)
- [ ] Set procurement team phone number
- [ ] Test with real phone numbers
- [ ] Verify message delivery
- [ ] Check rate limits
- [ ] Monitor costs
- [ ] Set up error alerts
- [ ] Document escalation process
- [ ] Train staff on notification system
- [ ] Inform customers about notifications

---

## Support & Resources

### Documentation
- WhatsApp: https://developers.facebook.com/docs/whatsapp
- Twilio: https://www.twilio.com/docs/sms

### Support Contacts
- WhatsApp Issues: Facebook Business Support
- Twilio Issues: support@twilio.com
- ERP Issues: Check REPAIR_TECHNICIAN_ACCESS.md

---

## Changelog

**2024-04-15 - SMS/WhatsApp Integration**
- ✓ Unified notification service
- ✓ WhatsApp Business API integration
- ✓ Twilio SMS integration
- ✓ Automatic fallback logic
- ✓ Phone number formatting
- ✓ Batch sending support
- ✓ Progress updates via SMS/WhatsApp
- ✓ Parts requests to procurement team
- ✓ Quote notifications
- ✓ Unrepairable notifications
- ✓ Development mode logging
- ✓ Production-ready implementation
