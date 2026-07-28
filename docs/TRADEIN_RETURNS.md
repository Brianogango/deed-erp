# Trade-in & Customer Returns

## Modules

| UI label | Where | Document |
|---------|--------|----------|
| Buy-backs | After-Sales → Trade-in → Buy-backs (also Purchases → Trade-in) | `BBK` |
| Exchanges → **↩ Items Customer Returns** | Trade-in → Exchanges (return lines) | `EXC` return side |
| New Items for Customer | Exchange issue lines | `EXC` issue side |
| Returns (RMA) | After-Sales → Returns | `RMA` |

“↩ Items Customer Returns” is the **exchange return-lines** section, not the RMA list.

## Customer selection

Buyback and exchange use `CustomerPickerField`:

- Search keeps the selected name in the picker (`formatSelected` / `selectedLabel`)
- Selected customer card with Clear
- Quick register (name / email / phone → `addContact`) when the client is not on file

## Products

Line editors use `SearchPicker` on product name + SKU (not a full native `<select>`).

## Returned serials

For serialized products on **return** paths (buyback lines, exchange return lines, RMA lines):

1. **From sold stock** — pick serials with status `sold` or location `customer`. Serials linked to the selected customer / original SO are ranked first.
2. **Enter new serial** — type a serial that is not in Deed. `registerCustomerReturnSerial` creates it as `sold` @ `customer`, audits `serial_return_intake`, then attaches the id to the line.

Exchange **New Items** stay search-only against warehouse `available` / `refurbishment` stock (no free-entry).

## Stock effects

- Buyback `stockBuyBack`: restores return serials to `available` (or `refurbishment` if condition is poor) at the destination; refuses missing serial ids.
- Exchange `completeExchange`: return serials → warehouse `available`; issue serials → `sold` @ customer.
- RMA `receiveReturn`: requires approve first; serialized lines must have matching serial count; serials → `returned` @ warehouse.

## Bulk import

Buyback / exchange spreadsheet serial columns accept unknown return serials when they can be registered via intake. Issue (new) serials must already exist in warehouse stock.
